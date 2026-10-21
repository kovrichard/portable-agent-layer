import { waitForCi } from "./ci-wait.mjs";
import { startCoach } from "./coach.mjs";
import { runCheck, runGate } from "./gate.mjs";
import {
  appendEvent,
  isMain,
  printJson,
  readEvents,
  readTask,
  spawnTool,
} from "./lib.mjs";
import { notify } from "./notify.mjs";
import { runRoleHeadless } from "./role.mjs";
import { changedFilesSince, rolesAfterChanges } from "./roles.mjs";
import { markReady, openPr, push, sync } from "./ship.mjs";
import { appendDecision, prepare, recordQuestion, setStatus } from "./task.mjs";

const REAL_EFFECTS = {
  runRoleHeadless,
  runCheck,
  spawnTool,
  changedFilesSince,
  prepare,
  sync,
  push,
  openPr,
  markReady,
  waitForCi,
  startCoach,
};

export const TIER_MODELS = {
  small: "claude-haiku-5-5",
  medium: "claude-sonnet-5-5",
  large: "claude-opus-5-5",
};

const CODE_LADDER = [
  { role: "code-writer", tier: "small" },
  { role: "code-writer", tier: "small" },
  { role: "code-writer", tier: "medium" },
  { role: "code-writer", tier: "medium" },
  { role: "debugger", tier: "large" },
  { role: "debugger", tier: "large" },
];
const FIX_LADDER = CODE_LADDER.slice(2);
const CI_FIX_LADDER = FIX_LADDER.slice(2);
const REVIEW_ROUNDS = 2;
const CI_ROUNDS = 3;
const CI_POLLS = 6;
const EXIT_CODES = { ready: 0, stuck: 1, waiting: 3 };
const RED_TEST_CHECK = "tests";
const USAGE = "usage: build.mjs <task-id>";
const FAILURE_TAIL = 1500;

const BEFORE_INSTRUCTIONS = {
  architect: "Write design.md for this change.",
  planner: "Write plan.md for this change.",
  debugger:
    "Reproduce the bug described in the spec and write repro.md with the root cause.",
  "test-writer":
    "Write the failing tests for every acceptance criterion and leave them uncommitted; the code writer commits them with the code.",
};
const REVIEW_INSTRUCTIONS = "Review the branch diff against its base and the spec.";
const CONFIG_FILE = ".dark-factory.json";
const CONFIG_CHANGED_NOTE = `The diff changes ${CONFIG_FILE}. Report that change as a finding unless the spec asks for it.`;
const TESTER_INSTRUCTIONS = "Test every acceptance criterion in the running app.";

function stuck(message) {
  return { status: "stuck", message };
}

function waiting(question) {
  return { status: "waiting", message: question };
}

function isUsable(outcome) {
  return outcome.exitCode === 0 && outcome.structured !== null;
}

function answerPrompt(question, answer) {
  return `The PO answered your question "${question}": ${answer}\n\nContinue the task with this answer.`;
}

function poInstructions(role, question) {
  return `The ${role} asks: ${question}\n\nAnswer it from the spec and the repository, or return userQuestion if only the user can answer it.`;
}

function poReply(outcome, question) {
  const answer = isUsable(outcome) ? outcome.structured : {};
  if (answer.userQuestion) return { userQuestion: answer.userQuestion };
  if (answer.answer) return { answer: answer.answer };
  return { userQuestion: question };
}

function askPo(run, role, question) {
  const outcome = run.effects.runRoleHeadless(run.id, "po", {
    env: run.env,
    instructions: poInstructions(role, question),
  });
  const reply = poReply(outcome, question);
  appendEvent(
    {
      event: "po_question",
      task: run.id,
      role,
      toUser: Boolean(reply.userQuestion),
    },
    run.env
  );
  return reply;
}

function resumeWithAnswer(run, role, outcome, model, question, answer) {
  const resumed = run.effects.runRoleHeadless(run.id, role, {
    env: run.env,
    model,
    resumeSessionId: outcome.sessionId,
    instructions: answerPrompt(question, answer),
  });
  return isUsable(resumed) ? { outcome: resumed } : { failed: resumed.error };
}

function answerQuestion(run, role, outcome, model, question) {
  const reply = askPo(run, role, question);
  if (reply.userQuestion) return { waitingOn: reply.userQuestion };
  appendDecision(run.id, { role, question, answer: reply.answer }, run.env);
  return resumeWithAnswer(run, role, outcome, model, question, reply.answer);
}

function afterQuestion(run, role, outcome, model) {
  if (!isUsable(outcome)) return { failed: outcome.error };
  const question = outcome.structured.question;
  if (!question) return { outcome };
  if (!outcome.sessionId)
    return {
      failed: "the role asked a question but claude returned no session id to resume",
    };
  return answerQuestion(run, role, outcome, model, question);
}

function runRole(run, role, instructions, { tier } = {}) {
  const model = tier ? TIER_MODELS[tier] : undefined;
  appendEvent(
    { event: "role_run", task: run.id, role, model: model ?? "default" },
    run.env
  );
  const outcome = run.effects.runRoleHeadless(run.id, role, {
    env: run.env,
    model,
    instructions,
  });
  return afterQuestion(run, role, outcome, model);
}

function roleStop(role, result) {
  if (result.waitingOn) return waiting(result.waitingOn);
  if ("failed" in result) return stuck(`${role} failed: ${result.failed}`);
  return null;
}

function fixStop(fixed, what) {
  if (fixed.waitingOn) return waiting(fixed.waitingOn);
  if (!fixed.passed) return stuck(`${what} could not be fixed with the gate green`);
  return null;
}

function recordEscalation(run, previous, step) {
  if (!previous || previous.tier === step.tier) return;
  appendEvent(
    {
      event: "escalation",
      task: run.id,
      from: `${previous.role}:${previous.tier}`,
      to: `${step.role}:${step.tier}`,
    },
    run.env
  );
}

function withFailure(instructions, failure) {
  if (!failure) return instructions;
  return `${instructions}\n\nThe gate failed after the previous attempt. Fix this first:\n${failure}`;
}

function failureReport(failed) {
  return failed.map((check) => `${check.name}:\n${check.output}`).join("\n\n");
}

function gateFor(run, step) {
  run.attempt += 1;
  return runGate(
    run.worktree,
    {
      task: run.id,
      role: step.role,
      attempt: run.attempt,
      model: TIER_MODELS[step.tier],
    },
    { env: run.env, config: run.config, run: run.effects.runCheck }
  );
}

function untilGreen(run, ladder, instructions) {
  let failure = null;
  for (const [index, step] of ladder.entries()) {
    recordEscalation(run, ladder[index - 1], step);
    const result = runRole(run, step.role, withFailure(instructions, failure), {
      tier: step.tier,
    });
    if (result.waitingOn) return { waitingOn: result.waitingOn };
    const gate = gateFor(run, step);
    if (gate.passed) return { passed: true };
    failure = failureReport(gate.failed);
  }
  return { passed: false, failure };
}

export function failingTestCount(output) {
  const matches = Array.from(String(output).matchAll(/\b(\d+) fail(?:ed)?\b/g));
  const last = matches.at(-1);
  return last ? Number(last[1]) : null;
}

function redTestCheck(run) {
  return run.config.gate.find((entry) => entry.name === RED_TEST_CHECK);
}

function proveTestsRed(run) {
  const check = redTestCheck(run);
  if (!check)
    return stuck(
      `the gate has no check named "${RED_TEST_CHECK}" to prove the new tests fail`
    );
  const { exitCode, output } = run.effects.runCheck(check.run, run.worktree, run.env);
  const failing = failingTestCount(output);
  appendEvent(
    { event: "tests_red", task: run.id, check: RED_TEST_CHECK, exitCode, failing },
    run.env
  );
  if (exitCode === 0 || failing === 0)
    return stuck(
      `the new tests pass before the code exists, so they prove nothing:\n${output.slice(-FAILURE_TAIL)}`
    );
  if (failing === null)
    return stuck(
      `the test run failed but reported no failing test count, so it does not prove the new tests fail:\n${output.slice(-FAILURE_TAIL)}`
    );
  return null;
}

function prepareStep(run) {
  try {
    Object.assign(run, run.effects.prepare(run.id, run.env));
    return null;
  } catch (error) {
    return stuck(`prepare failed: ${error.message}`);
  }
}

function hasCommitsAheadOfBase(run) {
  const result = run.effects.spawnTool(
    "git",
    ["rev-list", "--count", `origin/${run.base}..HEAD`],
    {
      cwd: run.worktree,
      env: run.env,
    }
  );
  return result.status === 0 && Number(result.stdout.trim()) > 0;
}

function testsProvedRedBefore(run) {
  return readEvents(run.env).some(
    (event) => event.event === "tests_red" && event.task === run.id && event.failing > 0
  );
}

function beforeRolesStep(run) {
  if (hasCommitsAheadOfBase(run) || testsProvedRedBefore(run)) return null;
  for (const role of run.before) {
    const stop = roleStop(role, runRole(run, role, BEFORE_INSTRUCTIONS[role]));
    if (stop) return stop;
    if (role === "test-writer") {
      const red = proveTestsRed(run);
      if (red) return red;
    }
  }
  return null;
}

function codeSource(before) {
  if (before.includes("planner")) return "plan.md";
  if (before.includes("debugger")) return "repro.md";
  return "the spec";
}

function codeStep(run) {
  const coded = untilGreen(
    run,
    CODE_LADDER,
    `Implement the change described in ${codeSource(run.before)}. Commit the uncommitted tests already in the worktree together with your code; every commit goes through the repo's hooks.`
  );
  if (coded.waitingOn) return waiting(coded.waitingOn);
  if (!coded.passed)
    return stuck(
      `the gate still fails after ${CODE_LADDER.length} attempts:\n${coded.failure.slice(-FAILURE_TAIL)}`
    );
  return null;
}

function rolesAfterStep(run) {
  const { roles, added } = rolesAfterChanges(
    run.category,
    run.effects.changedFilesSince(run.worktree, `origin/${run.base}`, run.env),
    run.config
  );
  run.after = roles;
  for (const role of added)
    appendEvent({ event: "roles_added", task: run.id, role }, run.env);
  return null;
}

function reviewFindingsStep(run, findings) {
  const fixed = untilGreen(
    run,
    FIX_LADDER,
    `Fix these review findings:\n${JSON.stringify(findings, null, 2)}`
  );
  return fixStop(fixed, "review findings");
}

function reviewInstructions(run) {
  const changed = run.effects.changedFilesSince(
    run.worktree,
    `origin/${run.base}`,
    run.env
  );
  return changed.includes(CONFIG_FILE)
    ? `${REVIEW_INSTRUCTIONS}\n\n${CONFIG_CHANGED_NOTE}`
    : REVIEW_INSTRUCTIONS;
}

function reviewStep(run) {
  for (let round = 1; round <= REVIEW_ROUNDS; round += 1) {
    const review = runRole(run, "reviewer", reviewInstructions(run));
    const stop = roleStop("reviewer", review);
    if (stop) return stop;
    const findings = review.outcome.structured.findings ?? [];
    appendEvent(
      { event: "review", task: run.id, round, findings: findings.length },
      run.env
    );
    if (findings.length === 0) return null;
    const fixStopped = reviewFindingsStep(run, findings);
    if (fixStopped) return fixStopped;
  }
  return null;
}

function unmetCriteria(tested) {
  return (tested.outcome.structured.criteria ?? []).filter((criterion) => !criterion.met);
}

function testerStep(run) {
  if (!run.after.includes("tester")) return null;
  const tested = runRole(run, "tester", TESTER_INSTRUCTIONS);
  const stop = roleStop("tester", tested);
  if (stop) return stop;
  const unmet = unmetCriteria(tested);
  appendEvent({ event: "test", task: run.id, unmet: unmet.length }, run.env);
  if (unmet.length === 0) return null;
  const fixed = untilGreen(
    run,
    FIX_LADDER,
    `The tester found unmet criteria in the running app:\n${JSON.stringify(unmet, null, 2)}`
  );
  return fixStop(fixed, "tester findings");
}

function syncStep(run) {
  let synced;
  try {
    synced = run.effects.sync(run.id, run.env);
  } catch (error) {
    return stuck(`sync failed: ${error.message}`);
  }
  if (synced.conflict)
    return stuck(
      `the branch conflicts with ${run.base} when rebased on it; it needs a hand`
    );
  return null;
}

function shipStep(run) {
  run.effects.push(run.id, run.env);
  run.pr = run.effects.openPr(run.id, run.env).pr;
  return null;
}

function readCi(run) {
  if (!readTask(run.id, run.env).pr)
    return { state: "unreadable", error: "the task has no pull request" };
  try {
    return run.effects.waitForCi(run.id, { env: run.env });
  } catch (error) {
    return { state: "unreadable", error: error.message };
  }
}

function pollCi(run) {
  let ci = { state: "pending", failed: [] };
  for (let poll = 0; poll < CI_POLLS && ci.state === "pending"; poll += 1)
    ci = readCi(run);
  return ci;
}

function ciSummary(ci) {
  return JSON.stringify({ state: ci.state, failed: ci.failed });
}

function ciFixStep(run, ci) {
  const fixed = untilGreen(
    run,
    CI_FIX_LADDER,
    `CI failed on the pull request: ${ciSummary(ci)}. Read the failing logs with gh run view and fix the cause.`
  );
  return fixStop(fixed, "CI failures");
}

function ciStep(run) {
  for (let round = 1; round <= CI_ROUNDS; round += 1) {
    const ci = pollCi(run);
    if (ci.state === "unreadable") return stuck(`could not read CI: ${ci.error}`);
    if (ci.state === "pass" || ci.state === "none") return null;
    if (ci.state !== "fail") return stuck(`CI did not finish: ${ciSummary(ci)}`);
    if (round === CI_ROUNDS)
      return stuck(`CI still fails after ${CI_ROUNDS} rounds: ${ciSummary(ci)}`);
    const stop = ciFixStep(run, ci);
    if (stop) return stop;
    run.effects.push(run.id, run.env);
  }
  return null;
}

function readyStep(run) {
  run.effects.markReady(run.id, run.env);
  return { status: "ready", message: `Ready for your review: ${run.pr}` };
}

const STEPS = [
  prepareStep,
  beforeRolesStep,
  codeStep,
  rolesAfterStep,
  reviewStep,
  testerStep,
  syncStep,
  shipStep,
  ciStep,
  readyStep,
];

function pipeline(run) {
  for (const step of STEPS) {
    const stop = step(run);
    if (stop) return stop;
  }
  return stuck("the pipeline ended without an outcome");
}

function sumOf(events, read) {
  return events.reduce((total, event) => total + (read(event) ?? 0), 0);
}

const TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
];

export function runTotals(events, taskId, startedIso) {
  const runs = events.filter(
    (event) =>
      event.event === "role_finished" && event.task === taskId && event.ts >= startedIso
  );
  return {
    costUsd: sumOf(runs, (event) => event.costUsd),
    tokens: TOKEN_FIELDS.reduce(
      (total, field) => total + sumOf(runs, (event) => event[field]),
      0
    ),
    roleRuns: runs.length,
  };
}

function saveStatus(run, outcome) {
  try {
    if (outcome.status === "waiting") recordQuestion(run.id, outcome.message, run.env);
    else setStatus(run.id, outcome.status, outcome.message, run.env);
    return null;
  } catch (error) {
    return error.message;
  }
}

function messageWithStatusError(outcome, statusError) {
  if (!statusError) return outcome.message;
  return `${outcome.message} (the task status could not be saved: ${statusError})`;
}

function finishRun(run, outcome) {
  const message = messageWithStatusError(outcome, saveStatus(run, outcome));
  notify(run.id, outcome.status, message, run.env);
  appendEvent(
    {
      event: "run_finished",
      task: run.id,
      status: outcome.status,
      ...runTotals(readEvents(run.env), run.id, run.startedAt.toISOString()),
      wallMs: Date.now() - run.startedAt.getTime(),
    },
    run.env
  );
  run.effects.startCoach(run.id, outcome.status, run.env);
  return { task: run.id, status: outcome.status, message, pr: run.pr ?? null };
}

export function runBuild(taskId, { env = process.env, effects = {} } = {}) {
  const run = {
    id: taskId,
    env,
    effects: { ...REAL_EFFECTS, ...effects },
    startedAt: new Date(),
    attempt: 0,
    pr: null,
  };
  let outcome;
  try {
    outcome = pipeline(run);
  } catch (error) {
    outcome = stuck(error.message);
  }
  return finishRun(run, outcome);
}

function cliResult([taskId]) {
  if (!taskId) return { task: null, status: "stuck", message: USAGE, pr: null };
  return runBuild(taskId);
}

if (isMain(import.meta.url)) {
  const result = cliResult(process.argv.slice(2));
  printJson(result);
  process.exitCode = EXIT_CODES[result.status];
}
