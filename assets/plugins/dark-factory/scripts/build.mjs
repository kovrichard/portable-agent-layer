import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { waitForCi } from "./ci-wait.mjs";
import { startCoach } from "./coach.mjs";
import { runCheck, runGate } from "./gate.mjs";
import { recordHandover } from "./handover.mjs";
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
import {
  appendDecision,
  prepare,
  recordQuestion,
  setStatus,
  withoutDecisions,
} from "./task.mjs";
import { superviseBuild } from "./worker.mjs";

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
const PLAN_GATE_ROUNDS = 2;
const CI_ROUNDS = 2;
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
const ACCEPTANCE_TESTS_INSTRUCTIONS =
  "Write the failing acceptance tests from spec.md only; there is no plan yet, so do not read plan.md. Write tests.md in the task folder mapping each test to the acceptance criteria it covers. Leave the tests uncommitted; the code writer commits them with the code.";
const PLAN_AFTER_TESTS_INSTRUCTIONS =
  "Write plan.md for this change. Failing acceptance tests already exist in the worktree (see tests.md in the task folder); the plan must make them pass without changing them.";
const UNIT_TESTS_INSTRUCTIONS =
  "Type one unit test per row of each example table in plan.md, in the test files the plan names. Test only what the tables state, change no other file, and leave the tests uncommitted. When plan.md has no example tables, change nothing.";
const SETTLE_PLAN_INSTRUCTIONS =
  "The plan gate ended with findings it could not settle, and their answers are now in the spec's Decisions. Read spec.md again and apply its Decisions to plan.md.";
const REPLAN_INSTRUCTIONS =
  "The spec changed since plan.md was written. Revise plan.md for the change. The branch already has commits, so plan only what is still to do.";
const PLAN_GATE_INSTRUCTIONS =
  'This is the plan gate: there is no code and no diff yet, so ignore the branch diff. Review plan.md against spec.md only. Report one finding with file "plan.md" for each place where the plan narrows an acceptance criterion; adds behaviour, events, options, flags, files or dependencies that no criterion asks for; contradicts the spec, its Decisions or its Must not change; or leaves a decision to the code writer. Return an empty findings list when the plan does none of these.';
const TESTS_AFTER_REPLAN_INSTRUCTIONS =
  "The spec changed and plan.md was revised. Work from spec.md only and do not read plan.md. Add failing tests only for the acceptance criteria that tests.md does not cover yet, update tests.md, and leave the new tests uncommitted; the code writer commits them with the code. When tests.md already covers every criterion, change nothing.";
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
  const instructions = poInstructions(role, question);
  recordHandover(
    run.id,
    { from: role, to: "po", reason: "question", payload: instructions },
    run.env
  );
  const outcome = run.effects.runRoleHeadless(run.id, "po", {
    env: run.env,
    instructions,
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
  const instructions = answerPrompt(question, answer);
  recordHandover(
    run.id,
    { from: "po", to: role, reason: "po-answer", payload: instructions },
    run.env
  );
  const resumed = run.effects.runRoleHeadless(run.id, role, {
    env: run.env,
    model,
    resumeSessionId: outcome.sessionId,
    instructions,
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

function handOver(run, role, reason, instructions) {
  recordHandover(
    run.id,
    { from: run.lastRole ?? "po", to: role, reason, payload: instructions },
    run.env
  );
  run.lastRole = role;
}

function runRole(
  run,
  role,
  instructions,
  { tier, reason = "pipeline", resumeSessionId } = {}
) {
  const model = tier ? TIER_MODELS[tier] : undefined;
  handOver(run, role, reason, instructions);
  appendEvent(
    { event: "role_run", task: run.id, role, model: model ?? "default" },
    run.env
  );
  const outcome = run.effects.runRoleHeadless(run.id, role, {
    env: run.env,
    model,
    instructions,
    resumeSessionId,
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

function untilGreen(run, ladder, instructions, reason) {
  let failure = null;
  for (const [index, step] of ladder.entries()) {
    recordEscalation(run, ladder[index - 1], step);
    const result = runRole(run, step.role, withFailure(instructions, failure), {
      tier: step.tier,
      reason: failure ? "gate-failed" : reason,
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

export function planGateEndedWithFindings(events, taskId) {
  const gates = events.filter(
    (event) => event.event === "plan_gate" && event.task === taskId
  );
  const latest = gates.at(-1);
  return Boolean(latest) && latest.findings > 0;
}

export function worktreeStatusChanged(before, after) {
  if (before === null || after === null) return true;
  return before !== after;
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

function specSha256(run) {
  return createHash("sha256")
    .update(withoutDecisions(readFileSync(run.specPath, "utf8")))
    .digest("hex");
}

function recordPlanWritten(run, specHash) {
  appendEvent({ event: "plan_written", task: run.id, specSha256: specHash }, run.env);
}

function planWith(run, instructions, reason, resumeSessionId) {
  const specHash = specSha256(run);
  const result = runRole(run, "planner", instructions, { reason, resumeSessionId });
  if (!roleStop("planner", result)) recordPlanWritten(run, specHash);
  return result;
}

function runPlanner(run, instructions, reason, resumeSessionId) {
  return roleStop("planner", planWith(run, instructions, reason, resumeSessionId));
}

function latestPlanSha256(run) {
  const plans = readEvents(run.env).filter(
    (event) => event.event === "plan_written" && event.task === run.id
  );
  return plans.at(-1)?.specSha256 ?? null;
}

function latestPlannerSessionId(events, taskId) {
  const sessions = events.filter(
    (event) =>
      event.event === "role_finished" &&
      event.task === taskId &&
      event.role === "planner" &&
      typeof event.sessionId === "string" &&
      event.sessionId !== ""
  );
  return sessions.at(-1)?.sessionId ?? null;
}

function planPath(run) {
  return join(run.taskDir, "plan.md");
}

function planOlderThanSpec(run) {
  return statSync(run.specPath).mtimeMs > statSync(planPath(run)).mtimeMs;
}

function specChangedSincePlan(run) {
  if (!run.before.includes("planner")) return false;
  if (!existsSync(planPath(run))) return true;
  const recorded = latestPlanSha256(run);
  if (recorded !== null) return recorded !== specSha256(run);
  return planOlderThanSpec(run);
}

function resumeFromTheStart(run) {
  run.resume = { head: null, through: -1 };
}

function planRevisionInstructions(findings) {
  return `The plan gate found these problems in plan.md:\n${JSON.stringify(findings, null, 2)}\n\nRevise plan.md to fix only these findings and change nothing else.`;
}

function planGateUnsettled(findings) {
  const listed = findings.map((finding) => `- ${finding.problem} Fix: ${finding.fix}`);
  return `The plan gate still reports findings after ${PLAN_GATE_ROUNDS} rounds; the PO settles them:\n${listed.join("\n")}`;
}

function recordPlanGate(run, round, findings) {
  appendEvent(
    { event: "plan_gate", task: run.id, round, findings: findings.length },
    run.env
  );
}

function revisePlan(run, findings) {
  const sessionId = latestPlannerSessionId(readEvents(run.env), run.id);
  return runPlanner(
    run,
    planRevisionInstructions(findings),
    "plan-findings",
    sessionId ?? undefined
  );
}

function planGateStep(run) {
  for (let round = 1; round <= PLAN_GATE_ROUNDS; round += 1) {
    const review = runRole(run, "reviewer", PLAN_GATE_INSTRUCTIONS, {
      reason: "plan-gate",
    });
    const stop = roleStop("reviewer", review);
    if (stop) return stop;
    const findings = review.outcome.structured.findings ?? [];
    recordPlanGate(run, round, findings);
    if (findings.length === 0) return null;
    if (round === PLAN_GATE_ROUNDS) return waiting(planGateUnsettled(findings));
    const revisionStop = revisePlan(run, findings);
    if (revisionStop) return revisionStop;
  }
  return null;
}

function planAndGate(run, instructions, reason) {
  const stop = runPlanner(run, instructions, reason);
  if (stop) return stop;
  return planGateStep(run);
}

function replan(run) {
  const sessionId = latestPlannerSessionId(readEvents(run.env), run.id);
  if (sessionId) {
    const resumed = planWith(run, REPLAN_INSTRUCTIONS, "spec-changed", sessionId);
    if (!("failed" in resumed)) return roleStop("planner", resumed);
  }
  return runPlanner(run, REPLAN_INSTRUCTIONS, "spec-changed");
}

function testsAfterReplan(run) {
  if (!run.before.includes("test-writer")) return null;
  const testWriter = runRole(run, "test-writer", TESTS_AFTER_REPLAN_INSTRUCTIONS, {
    reason: "spec-changed",
  });
  const stop = roleStop("test-writer", testWriter);
  if (stop) return stop;
  if (isWorktreeClean(run)) return null;
  return proveTestsRed(run);
}

function unitTestsStep(run) {
  if (!run.before.includes("test-writer")) return null;
  const before = worktreeStatus(run);
  const stop = roleStop(
    "test-writer",
    runRole(run, "test-writer", UNIT_TESTS_INSTRUCTIONS, { tier: "small" })
  );
  if (stop) return stop;
  return worktreeStatusChanged(before, worktreeStatus(run)) ? proveTestsRed(run) : null;
}

function testsAfterSettle(run, specChanged) {
  return specChanged ? testsAfterReplan(run) : null;
}

function settlePlanStep(run) {
  const specChanged = specChangedSincePlan(run);
  resumeFromTheStart(run);
  const sessionId = latestPlannerSessionId(readEvents(run.env), run.id);
  return (
    runPlanner(run, SETTLE_PLAN_INSTRUCTIONS, "plan-findings", sessionId ?? undefined) ??
    planGateStep(run) ??
    testsAfterSettle(run, specChanged) ??
    unitTestsStep(run)
  );
}

function replanIfSpecChanged(run) {
  if (!specChangedSincePlan(run)) return null;
  resumeFromTheStart(run);
  return replan(run) ?? planGateStep(run) ?? testsAfterReplan(run) ?? unitTestsStep(run);
}

function testWriterInstructions(before) {
  return before.includes("planner")
    ? ACCEPTANCE_TESTS_INSTRUCTIONS
    : BEFORE_INSTRUCTIONS["test-writer"];
}

function plannerInstructions(before) {
  return before.includes("test-writer")
    ? PLAN_AFTER_TESTS_INSTRUCTIONS
    : BEFORE_INSTRUCTIONS.planner;
}

function beforeRoleStep(run, role) {
  if (role === "planner")
    return (
      planAndGate(run, plannerInstructions(run.before), "pipeline") ?? unitTestsStep(run)
    );
  if (role === "test-writer")
    return (
      roleStop(role, runRole(run, role, testWriterInstructions(run.before))) ??
      proveTestsRed(run)
    );
  return roleStop(role, runRole(run, role, BEFORE_INSTRUCTIONS[role]));
}

function firstPlanStillOwed(run) {
  return (
    run.before.includes("planner") &&
    !existsSync(planPath(run)) &&
    latestPlanSha256(run) === null
  );
}

function resumeFirstPlan(run) {
  return beforeRoleStep(run, "planner");
}

function beforeRolesStep(run) {
  if (planGateEndedWithFindings(readEvents(run.env), run.id)) return settlePlanStep(run);
  const hasCommits = hasCommitsAheadOfBase(run);
  if (!hasCommits && testsProvedRedBefore(run) && firstPlanStillOwed(run))
    return resumeFirstPlan(run);
  if (hasCommits || testsProvedRedBefore(run)) return replanIfSpecChanged(run);
  for (const role of run.before) {
    const stop = beforeRoleStep(run, role);
    if (stop) return stop;
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
    `Implement the change described in ${codeSource(run.before)}. Commit the uncommitted tests already in the worktree together with your code; every commit goes through the repo's hooks.`,
    "pipeline"
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
    `Fix these review findings:\n${JSON.stringify(findings, null, 2)}`,
    "review-findings"
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
    `The tester found unmet criteria in the running app:\n${JSON.stringify(unmet, null, 2)}`,
    "unmet-criteria"
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

function readCi(run, options = {}) {
  if (!readTask(run.id, run.env).pr)
    return { state: "unreadable", error: "the task has no pull request" };
  try {
    return run.effects.waitForCi(run.id, { env: run.env, ...options });
  } catch (error) {
    return { state: "unreadable", error: error.message };
  }
}

function pollCi(run, options = {}) {
  let ci = { state: "pending", failed: [] };
  for (let poll = 0; poll < CI_POLLS && ci.state === "pending"; poll += 1)
    ci = readCi(run, options);
  return ci;
}

function ciSummary(ci) {
  return JSON.stringify({ state: ci.state, failed: ci.failed });
}

function ciFixStep(run, ci) {
  const fixed = untilGreen(
    run,
    CI_FIX_LADDER,
    `CI failed on the pull request: ${ciSummary(ci)}. Read the failing logs with gh run view and fix the cause.`,
    "ci-failed"
  );
  return fixStop(fixed, "CI failures");
}

function unfinishedCiStop(ci) {
  if (ci.state === "unreadable") return stuck(`could not read CI: ${ci.error}`);
  if (ci.state === "pass" || ci.state === "none" || ci.state === "fail") return null;
  return stuck(`CI did not finish: ${ciSummary(ci)}`);
}

function ciPassed(ci) {
  return ci.state === "pass" || ci.state === "none";
}

function externalFailure(ci) {
  return `CI fails on ${ci.failed.join(", ")} although the fix step committed nothing, so the failure is not caused by the branch's changes (external or flaky)`;
}

function rerunOne(run, id) {
  let result;
  try {
    result = run.effects.spawnTool("gh", ["run", "rerun", id, "--failed"], {
      cwd: run.worktree,
      env: run.env,
    });
  } catch (error) {
    return `${id}: ${error.message}`;
  }
  if (result.status === 0) return null;
  return `${id}: ${result.stderr.trim() || `exit ${result.status}`}`;
}

function rerunFailedRuns(run, runIds) {
  if (runIds.length === 0)
    return { ok: false, error: "no failed GitHub Actions run to rerun" };
  const failures = runIds.map((id) => rerunOne(run, id)).filter(Boolean);
  return { ok: failures.length === 0, error: failures.join("; ") || null };
}

function recordRerun(run, ci, rerun) {
  appendEvent(
    {
      event: "ci_rerun",
      task: run.id,
      sha: ci.sha ?? null,
      runs: ci.runs ?? [],
      ok: rerun.ok,
      error: rerun.error,
    },
    run.env
  );
}

function rerunCiStep(run, ci) {
  const rerun = rerunFailedRuns(run, ci.runs ?? []);
  recordRerun(run, ci, rerun);
  if (!rerun.ok) return stuck(`${externalFailure(ci)}; the rerun failed: ${rerun.error}`);
  const again = pollCi(run, { staleLinks: ci.links ?? [] });
  const stop = unfinishedCiStop(again);
  if (stop) return stop;
  if (ciPassed(again)) return null;
  return stuck(externalFailure(again));
}

function fixCommitted(before, after) {
  return before !== after;
}

function ciStep(run) {
  for (let round = 1; round <= CI_ROUNDS; round += 1) {
    const ci = pollCi(run);
    const stop = unfinishedCiStop(ci);
    if (stop) return stop;
    if (ciPassed(ci)) return null;
    if (round === CI_ROUNDS)
      return stuck(`CI still fails after ${CI_ROUNDS} rounds: ${ciSummary(ci)}`);
    const headBefore = worktreeHead(run);
    const fixStopped = ciFixStep(run, ci);
    if (fixStopped) return fixStopped;
    const headAfter = worktreeHead(run);
    if (headBefore === null || headAfter === null)
      return stuck("could not read CI: worktree HEAD unreadable");
    if (!fixCommitted(headBefore, headAfter)) return rerunCiStep(run, ci);
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

const RESUMABLE_STEPS = new Map([
  [codeStep, "code"],
  [reviewStep, "review"],
  [testerStep, "tester"],
]);
const RESUME_ORDER = ["code", "review", "tester"];

function gitOutput(run, args) {
  const result = run.effects.spawnTool("git", args, { cwd: run.worktree, env: run.env });
  return result.status === 0 ? result.stdout.trim() : null;
}

function worktreeHead(run) {
  return gitOutput(run, ["rev-parse", "HEAD"]);
}

function worktreeStatus(run) {
  return gitOutput(run, ["status", "--porcelain"]);
}

function isWorktreeClean(run) {
  return worktreeStatus(run) === "";
}

function latestStepDone(run) {
  return readEvents(run.env)
    .filter((event) => event.event === "step_done" && event.task === run.id)
    .at(-1);
}

function resumePoint(run) {
  const head = worktreeHead(run);
  const latest = latestStepDone(run);
  const through =
    head !== null && latest?.head === head && isWorktreeClean(run)
      ? RESUME_ORDER.indexOf(latest.step)
      : -1;
  return { head, through };
}

function finishedAtHead(run, name) {
  run.resume ??= resumePoint(run);
  return RESUME_ORDER.indexOf(name) <= run.resume.through;
}

function recordStep(run, event, name, head) {
  appendEvent({ event, task: run.id, step: name, head }, run.env);
}

function runStep(run, step) {
  const name = RESUMABLE_STEPS.get(step);
  if (!name) return step(run);
  if (finishedAtHead(run, name)) {
    recordStep(run, "step_skipped", name, run.resume.head);
    return null;
  }
  const stop = step(run);
  if (!stop) recordStep(run, "step_done", name, worktreeHead(run));
  return stop;
}

function pipeline(run) {
  for (const step of STEPS) {
    const stop = runStep(run, step);
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

async function cliResult([taskId]) {
  if (!taskId) return { task: null, status: "stuck", message: USAGE, pr: null };
  return superviseBuild(taskId);
}

if (isMain(import.meta.url)) {
  const result = await cliResult(process.argv.slice(2));
  printJson(result);
  process.exitCode = EXIT_CODES[result.status];
}
