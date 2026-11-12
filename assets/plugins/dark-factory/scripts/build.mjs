import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForCi } from "./ci-wait.mjs";
import { startCoach } from "./coach.mjs";
import { gateEntriesFor, runCheck, runGate } from "./gate.mjs";
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
import { changedFilesSince, rolesAfterChanges, rolesFor } from "./roles.mjs";
import { markReady, openPr, push, sync } from "./ship.mjs";
import {
  appendDecision,
  markStarted,
  prepare,
  recordQuestion,
  setStatus,
  withoutDecisions,
} from "./task.mjs";
import { superviseBuild } from "./worker.mjs";

export { runTotals } from "./lib.mjs";

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
  flagship: "claude-fable-5-2",
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
const STUB_RULE =
  "When a test names a function, type or method that plan.md defines and that does not exist yet, add it where plan.md puts it, with the plan's signature and a body that only fails when it runs (todo!() in Rust, panic in Go, a thrown error elsewhere), so the tests compile and fail; the code writer replaces it.";
const UNIT_TESTS_INSTRUCTIONS = `Type one unit test per row of each example table in plan.md, in the test files the plan names. Test only what the tables state, change no other file except for those stubs, and leave everything uncommitted. ${STUB_RULE} When plan.md has no example tables, change nothing.`;
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
const TASK_DOCUMENTS = ["spec.md", "plan.md", "design.md", "repro.md", "tests.md"];
const UNPLANNED_FILES_ASKER = "build";
const TEST_FIX_LIMIT = 2;
const TEST_WRITER_GATE_ATTEMPTS = 3;
export const FINGERPRINT_UNREADABLE =
  "could not fingerprint the worktree around the test fix, so the files it changed cannot be checked";
const TEST_FIX_DIFF_UNREADABLE =
  "could not list the files the test fix changed: git diff --name-only failed";
const TEST_EDITS_EVENT = "test_edits_restored";
const UNIT_TESTS_NO_RISE_EVENT = "unit_tests_no_rise";
const UNIT_TESTS_NO_COMPILE_EVENT = "unit_tests_do_not_compile";

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

  if (answer.answer)
    return { answer: answer.answer, revert: answer.revert, testFix: answer.testFix };

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
  const fixed = fixTestIfRuled(run, role, reply);
  if (fixed.stop) return { stop: fixed.stop };

  return resumeWithAnswer(
    run,
    role,
    outcome,
    model,
    question,
    withFixedTests(reply.answer, fixed.files)
  );
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

export function requestedTestFix(testFix) {
  if (!testFix || !Array.isArray(testFix.files) || testFix.files.length === 0)
    return null;

  return {
    files: testFix.files,
    change: typeof testFix.change === "string" ? testFix.change : "",
  };
}

export function testFixInstructions(testFix, answer) {
  return `The PO ruled that a test contradicts the spec, and the test, not the code, must change. Change these test files:
${fileList(testFix.files)}

What must change: "${testFix.change}"

The PO's answer: "${answer}"

Change only these files, and only as the answer says. Leave the changes uncommitted.`;
}

function changedFilesText(files) {
  if (files === null)
    return "The files you changed could not be listed: git diff --name-only failed.";

  return `You changed these files:\n${fileList(files)}`;
}

function noRiseRetryInstructions(baseline, failing, files) {
  const changed = changedFilesText(files);

  return `Your unit tests did not raise the failing test count: ${baseline} before you typed them, ${failing} after. A test file that fails to load counts as one failure, however many tests it holds.

${changed}

Move the tests you added into a new test file that no other test uses, keep the tests themselves as they are, leave them uncommitted, and change no other file.`;
}

function noCompileRetryInstructions(error) {
  return `Your unit tests do not compile, so the test run reports no failing test count. The first error:
${error}

${STUB_RULE} Keep the tests as they are, leave everything uncommitted, and change no other file.`;
}

function unchangedNamedMessage(named, outside) {
  const base = `the test the PO ruled wrong was not changed: the test writer changed none of ${named.join(", ")}`;

  if (outside.length === 0) return base;

  return `${base}, and changed files the PO did not name: ${outside.join(", ")}`;
}

export function testFixScopeMessage(named, changed) {
  const outside = changed.filter((file) => !named.includes(file));
  const namedChanged = changed.some((file) => named.includes(file));
  if (!namedChanged) return unchangedNamedMessage(named, outside);

  if (outside.length === 0) return null;

  return `the test writer changed files the PO did not name: ${outside.join(", ")}`;
}

export function withFixedTests(answer, files) {
  if (files.length === 0) return answer;

  return `${answer}\n\nThe test writer changed these test files as the PO answered: ${files.join(", ")}`;
}

function changedBetween(run, before, after) {
  const output = gitOutput(run, ["diff", "--name-only", before, after]);
  if (output === null) return null;

  return output.split("\n").filter(Boolean);
}

function typistChangedFiles(run, before, after) {
  if (before === null || after === null) return null;

  return changedBetween(run, before, after);
}

function changedAfterFix(run, askedBy, testFix, before) {
  const after = worktreeFingerprint(run);
  if (after === null) return { stop: stuck(FINGERPRINT_UNREADABLE) };
  const changed = changedBetween(run, before, after);
  if (changed === null) return { stop: stuck(TEST_FIX_DIFF_UNREADABLE) };
  const message = testFixScopeMessage(testFix.files, changed);
  if (message) return { stop: stuck(message) };
  run.testFixTrees.push({ tree: after, files: changed });
  appendEvent({ event: "test_fixed", task: run.id, askedBy, files: changed }, run.env);

  return { files: changed };
}

function runTestFix(run, askedBy, testFix, answer) {
  const before = worktreeFingerprint(run);
  if (before === null) return { stop: stuck(FINGERPRINT_UNREADABLE) };
  const written = runRole(run, "test-writer", testFixInstructions(testFix, answer), {
    reason: "test-fix",
  });
  const roleStopped = roleStop("test-writer", written);
  if (roleStopped) return { stop: roleStopped };

  return changedAfterFix(run, askedBy, testFix, before);
}

function fixTestIfRuled(run, askedBy, reply) {
  const testFix = requestedTestFix(reply.testFix);
  if (!testFix) return { files: [] };

  if (run.testFixes >= TEST_FIX_LIMIT) {
    appendEvent(
      { event: "test_fix_skipped", task: run.id, files: testFix.files },
      run.env
    );

    return { files: [] };
  }

  run.testFixes += 1;

  return runTestFix(run, askedBy, testFix, reply.answer);
}

function handOver(run, role, reason, instructions) {
  recordHandover(
    run.id,
    { from: run.lastRole ?? "po", to: role, reason, payload: instructions },
    run.env
  );
  run.lastRole = role;
}

function planSlots(before, testsAgain = false) {
  if (!before.includes("test-writer")) return ["planner", "plan-gate"];

  return testsAgain
    ? ["planner", "plan-gate", "test-writer", "unit-tests"]
    : ["planner", "plan-gate", "unit-tests"];
}

function beforeSlots(before) {
  return before.flatMap((role) => (role === "planner" ? planSlots(before) : [role]));
}

function afterSlots(run) {
  const after = run.after ?? rolesFor(run.category).after;
  const slots = after.includes("tester") ? RESUME_ORDER : RESUME_ORDER.slice(0, -1);

  return slots.slice((run.resume?.through ?? -1) + 1);
}

function routeOf(run) {
  return [...run.beforeSlots, ...afterSlots(run)];
}

function enterSlot(run, slot) {
  const route = routeOf(run);
  if (route.indexOf(slot) > route.indexOf(run.slot)) run.slot = slot;
}

function nextProgress(run) {
  run.step += 1;
  const route = routeOf(run);
  const ahead = route.length - 1 - route.indexOf(run.slot);

  return { step: run.step, planned: run.step + ahead };
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
    {
      event: "role_run",
      task: run.id,
      role,
      model: model ?? "default",
      ...nextProgress(run),
    },
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
  if (result.stop) return result.stop;

  if (result.waitingOn) return waiting(result.waitingOn);

  if ("failed" in result) return stuck(`${role} failed: ${result.failed}`);

  return null;
}

function fixStop(fixed, what) {
  if (fixed.stop) return fixed.stop;

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

function gateRole(run, role, attempt, tier) {
  return runGate(
    run.worktree,
    { task: run.id, role, attempt, model: TIER_MODELS[tier] },
    { env: run.env, config: run.config, run: run.effects.runCheck }
  );
}

function gateFor(run, step) {
  run.attempt += 1;

  return gateRole(run, step.role, run.attempt, step.tier);
}

function testWriterGateStuck(failure) {
  return stuck(
    `the test writer's gate still fails after ${TEST_WRITER_GATE_ATTEMPTS} attempts:\n${failure.slice(-FAILURE_TAIL)}`
  );
}

function gatedTestWriter(run, instructions, options = {}) {
  const gated = gateEntriesFor(run.config, "test-writer").length > 0;
  let failure = null;

  for (let attempt = 1; attempt <= TEST_WRITER_GATE_ATTEMPTS; attempt += 1) {
    const result = runRole(run, "test-writer", withFailure(instructions, failure), {
      ...options,
      reason: failure ? "gate-failed" : options.reason,
    });
    if (!gated || roleStop("test-writer", result)) return result;
    const gate = gateRole(run, "test-writer", attempt, options.tier);
    if (gate.passed) return result;
    failure = failureReport(gate.failed);
  }

  return { stop: testWriterGateStuck(failure) };
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

    if (result.stop) return { stop: result.stop };
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

const COMPILE_ERROR_LINE =
  /^error(?:\[[A-Z]\d+\])?: (?!could not compile|test failed|\d+ targets? failed).*$/m;

export function firstCompileError(output) {
  return String(output).match(COMPILE_ERROR_LINE)?.[0] ?? null;
}

function missingCountMessage(output) {
  const tail = output.slice(-FAILURE_TAIL);
  const compileError = firstCompileError(output);
  if (compileError) return `the tests do not compile: ${compileError}\n${tail}`;

  return `the test run failed but reported no failing test count, so it does not prove the new tests fail:\n${tail}`;
}

function noRiseMessage(baseline, failing, output) {
  return `the unit tests did not raise the failing test count (${baseline} before the typist, ${failing} after), so they prove nothing; a test file that fails to load counts as one failure, however many tests it holds:\n${output.slice(-FAILURE_TAIL)}`;
}

function measureTestsRed(run, baseline) {
  const check = redTestCheck(run);
  if (!check)
    return {
      stop: stuck(
        `the gate has no check named "${RED_TEST_CHECK}" to prove the new tests fail`
      ),
    };
  const { exitCode, output } = run.effects.runCheck(check.run, run.worktree, run.env);
  const failing = failingTestCount(output);
  appendEvent(
    {
      event: "tests_red",
      task: run.id,
      check: RED_TEST_CHECK,
      exitCode,
      failing,
      baseline,
    },
    run.env
  );

  if (exitCode === 0 || failing === 0)
    return {
      stop: stuck(
        `the new tests pass before the code exists, so they prove nothing:\n${output.slice(-FAILURE_TAIL)}`
      ),
    };

  if (failing === null)
    return {
      stop: stuck(missingCountMessage(output)),
      compileError: firstCompileError(output),
    };

  if (baseline !== undefined && failing <= baseline)
    return { noRise: { failing, output } };

  return {};
}

export function proveTestsRed(run, baseline) {
  const proof = measureTestsRed(run, baseline);
  if (proof.noRise)
    return stuck(noRiseMessage(baseline, proof.noRise.failing, proof.noRise.output));

  return proof.stop ?? null;
}

function baselineFailingCount(exitCode, output) {
  if (exitCode === 0) return 0;

  return failingTestCount(output);
}

export function takeBaseline(run) {
  const check = redTestCheck(run);
  if (!check) return { baseline: 0 };
  const { exitCode, output } = run.effects.runCheck(check.run, run.worktree, run.env);
  const baseline = baselineFailingCount(exitCode, output);
  if (baseline === null) return { stop: stuck(missingCountMessage(output)) };

  return { baseline };
}

function prepareStep(run) {
  try {
    Object.assign(run, run.effects.prepare(run.id, run.env));

    if (readTask(run.id, run.env).status === "ready") markStarted(run.id, run.env);

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
  enterSlot(run, "planner");
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
  enterSlot(run, "plan-gate");

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
  enterSlot(run, "test-writer");
  const taken = takeBaseline(run);
  if (taken.stop) return taken.stop;
  const before = worktreeFingerprint(run);
  const stop = roleStop(
    "test-writer",
    gatedTestWriter(run, TESTS_AFTER_REPLAN_INSTRUCTIONS, {
      reason: "spec-changed",
    })
  );
  if (stop) return stop;

  return worktreeStatusChanged(before, worktreeFingerprint(run))
    ? proveTestsRed(run, taken.baseline)
    : null;
}

function retryTypistOnce(run, baseline, instructions, typist) {
  const retried = gatedTestWriter(run, instructions, {
    tier: "small",
    resumeSessionId: typist.sessionId ?? undefined,
  });
  const stop = roleStop("test-writer", retried);
  if (stop) return stop;

  return proveTestsRed(run, baseline);
}

function retryUnitTests(run, baseline, failing, typist) {
  const files = typistChangedFiles(run, typist.before, typist.after);
  appendEvent(
    { event: UNIT_TESTS_NO_RISE_EVENT, task: run.id, baseline, failing, files },
    run.env
  );

  return retryTypistOnce(
    run,
    baseline,
    noRiseRetryInstructions(baseline, failing, files),
    typist
  );
}

function retryUncompiledUnitTests(run, baseline, error, typist) {
  appendEvent(
    { event: UNIT_TESTS_NO_COMPILE_EVENT, task: run.id, baseline, error },
    run.env
  );

  return retryTypistOnce(run, baseline, noCompileRetryInstructions(error), typist);
}

function proveUnitTestsRed(run, baseline, typist) {
  const proof = measureTestsRed(run, baseline);
  if (proof.noRise) return retryUnitTests(run, baseline, proof.noRise.failing, typist);

  if (proof.compileError)
    return retryUncompiledUnitTests(run, baseline, proof.compileError, typist);

  return proof.stop ?? null;
}

function unitTestsStep(run) {
  if (!run.before.includes("test-writer")) return null;
  enterSlot(run, "unit-tests");
  const taken = takeBaseline(run);
  if (taken.stop) return taken.stop;
  const before = worktreeFingerprint(run);
  const typed = gatedTestWriter(run, UNIT_TESTS_INSTRUCTIONS, { tier: "small" });
  const stop = roleStop("test-writer", typed);
  if (stop) return stop;
  const after = worktreeFingerprint(run);
  const stopAfterProof = worktreeStatusChanged(before, after)
    ? proveUnitTestsRed(run, taken.baseline, {
        before,
        after,
        sessionId: typed.outcome.sessionId,
      })
    : null;
  if (!stopAfterProof) appendEvent({ event: "unit_tests_done", task: run.id }, run.env);

  return stopAfterProof;
}

function unitTestsOwed(run) {
  if (!run.before.includes("planner") || !run.before.includes("test-writer"))
    return false;
  const kinds = readEvents(run.env)
    .filter((event) => event.task === run.id)
    .map((event) => event.event);
  const lastPlan = kinds.lastIndexOf("plan_written");

  return lastPlan >= 0 && kinds.lastIndexOf("unit_tests_done") < lastPlan;
}

function resumeUnitTests(run) {
  if (!unitTestsOwed(run)) return null;
  run.beforeSlots = ["plan-gate", "unit-tests"];

  return planGateStep(run) ?? unitTestsStep(run);
}

function testsAfterSettle(run, specChanged) {
  return specChanged ? testsAfterReplan(run) : null;
}

function settlePlanStep(run) {
  const specChanged = specChangedSincePlan(run);
  resumeFromTheStart(run);
  run.beforeSlots = planSlots(run.before, specChanged);
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
  run.beforeSlots = planSlots(run.before, true);

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
  enterSlot(run, role);

  if (role === "planner")
    return (
      planAndGate(run, plannerInstructions(run.before), "pipeline") ?? unitTestsStep(run)
    );

  if (role === "test-writer")
    return (
      roleStop(role, gatedTestWriter(run, testWriterInstructions(run.before))) ??
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
  run.beforeSlots = planSlots(run.before);

  return beforeRoleStep(run, "planner");
}

function beforeRolesStep(run) {
  if (planGateEndedWithFindings(readEvents(run.env), run.id)) return settlePlanStep(run);
  const hasCommits = hasCommitsAheadOfBase(run);
  if (!hasCommits && testsProvedRedBefore(run) && firstPlanStillOwed(run))
    return resumeFirstPlan(run);

  if (hasCommits) return replanIfSpecChanged(run);

  if (testsProvedRedBefore(run)) return replanIfSpecChanged(run) ?? resumeUnitTests(run);
  run.beforeSlots = beforeSlots(run.before);

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

function codeLadderStep(run) {
  enterSlot(run, "code");
  const coded = untilGreen(
    run,
    CODE_LADDER,
    `Implement the change described in ${codeSource(run.before)}. Commit the uncommitted tests already in the worktree together with your code; every commit goes through the repo's hooks.`,
    "pipeline"
  );
  if (coded.stop) return coded.stop;

  if (coded.waitingOn) return waiting(coded.waitingOn);

  if (!coded.passed)
    return stuck(
      `the gate still fails after ${CODE_LADDER.length} attempts:\n${coded.failure.slice(-FAILURE_TAIL)}`
    );

  return null;
}

function guardedLadder(run, ladderStep) {
  const start = worktreeFingerprint(run);
  if (start === null) return stuck(FINGERPRINT_UNREADABLE);
  const fixesFrom = run.testFixTrees.length;

  return ladderStep() ?? testEditsStep(run, start, fixesFrom);
}

function codeStep(run) {
  return guardedLadder(run, () => codeLadderStep(run));
}

function protectedTestFiles(run, tree) {
  const output = gitOutput(run, ["ls-tree", "-r", "--name-only", tree]);
  if (output === null) return null;

  return output
    .split("\n")
    .filter(Boolean)
    .filter((file) => isTestFile(file, run.config.testPaths));
}

function filesChangedBetween(run, before, after) {
  const output = gitOutput(run, ["diff", "--name-only", "--no-renames", before, after]);
  if (output === null) return null;

  return output.split("\n").filter(Boolean);
}

function changedFilesByTree(run, baselines, end) {
  const changedByTree = new Map();

  for (const tree of new Set(baselines.map((entry) => entry.tree))) {
    const changed = filesChangedBetween(run, tree, end);
    if (changed === null) return null;
    changedByTree.set(tree, changed);
  }

  return changedByTree;
}

const EXEMPT_TEST_FILES_HEADING = "## Test files this task changes";

export function specTestFiles(specText) {
  const lines = String(specText)
    .split("\n")
    .map((line) => line.trimEnd());
  const start = lines.indexOf(EXEMPT_TEST_FILES_HEADING);
  if (start === -1) return [];
  const section = [];

  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#")) break;
    section.push(line);
  }

  return section
    .filter((line) => line.startsWith("- "))
    .map((line) =>
      line
        .slice(2)
        .trim()
        .replace(/^`(.*)`$/, "$1")
    )
    .filter((file) => file !== "");
}

function exemptTestFiles(run) {
  const specPath = join(run.taskDir, "spec.md");
  if (!existsSync(specPath)) return [];

  return specTestFiles(readFileSync(specPath, "utf8"));
}

export function editedTestFiles(run, start, fixesFrom) {
  const end = worktreeFingerprint(run);
  if (end === null) return { stop: stuck(FINGERPRINT_UNREADABLE) };
  const protectedFiles = protectedTestFiles(run, start);
  if (protectedFiles === null) return { stop: stuck(FINGERPRINT_UNREADABLE) };
  const exempt = exemptTestFiles(run);
  const files = protectedFiles.filter((file) => !exempt.includes(file));
  const baselines = baselineTrees(files, start, run.testFixTrees.slice(fixesFrom));
  const changedByTree = changedFilesByTree(run, baselines, end);
  if (changedByTree === null) return { stop: stuck(FINGERPRINT_UNREADABLE) };

  return { edits: editedBaselines(baselines, changedByTree) };
}

function testEditsStep(run, start, fixesFrom) {
  const found = editedTestFiles(run, start, fixesFrom);
  if (found.stop) return found.stop;

  if (found.edits.length === 0) return null;

  return restoreTestEdits(run, start, fixesFrom, found.edits);
}

function restoreTestEdits(run, start, fixesFrom, edits) {
  appendEvent(
    { event: TEST_EDITS_EVENT, task: run.id, files: edits.map((edit) => edit.file) },
    run.env
  );
  const fixed = untilGreen(
    run,
    FIX_LADDER,
    restoreTestEditsInstructions(edits),
    "test-edits"
  );
  const stop = fixStop(fixed, "the restore of the edited test files");
  if (stop) return stop;
  const again = editedTestFiles(run, start, fixesFrom);
  if (again.stop) return again.stop;

  if (again.edits.length === 0) return null;

  return stuck(testEditsAgainMessage(again.edits.map((edit) => edit.file)));
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

function parentDirectories(file) {
  return file
    .split("/")
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join("/"));
}

function mentionsDirectory(text, directory) {
  return text
    .split(`${directory}/`)
    .slice(1)
    .some((rest) => !/^[\w.-]/.test(rest));
}

function namesFile(text, file) {
  return (
    text.includes(file) ||
    parentDirectories(file).some((directory) => mentionsDirectory(text, directory))
  );
}

const TEST_DIRECTORIES = ["test", "tests", "__tests__"];
const TEST_NAME_MARKERS = [".test.", ".spec."];

export function isTestFile(file, testPaths) {
  if (Array.isArray(testPaths))
    return testPaths.some((prefix) => file.startsWith(prefix));
  const parts = file.split("/");
  const name = parts.at(-1);
  const directories = parts.slice(0, -1);

  return (
    TEST_NAME_MARKERS.some((marker) => name.includes(marker)) ||
    directories.some((directory) => TEST_DIRECTORIES.includes(directory))
  );
}

export function baselineTrees(protectedFiles, startTree, fixes) {
  return protectedFiles.map((file) => {
    const lastFix = fixes.filter((fix) => fix.files.includes(file)).at(-1);

    return { file, tree: lastFix ? lastFix.tree : startTree };
  });
}

export function editedBaselines(baselines, changedByTree) {
  return baselines.filter(({ file, tree }) =>
    (changedByTree.get(tree) ?? []).includes(file)
  );
}

function editedTestLine(edit) {
  return `- ${edit.file} (tree ${edit.tree})`;
}

export function restoreTestEditsInstructions(edits) {
  return `The code step changed these test files, and the code writer and the debugger never edit a test:
${edits.map(editedTestLine).join("\n")}

Restore each file to its content in the git tree named next to it, for example with \`git checkout <tree> -- <file>\`; a deleted file is recreated that way. Commit the restore; every commit goes through the repo's hooks. Then make the gate pass without editing any test. When a test seems wrong, ask the PO a question instead of changing it. Change none of these files again: a second change stops the build.`;
}

export function testEditsAgainMessage(files) {
  return `the test files were changed again after a restore: ${files.join(", ")}`;
}

export function unplannedFiles(changed, documentTexts, listedBefore) {
  return changed.filter(
    (file) =>
      !listedBefore.includes(file) && !documentTexts.some((text) => namesFile(text, file))
  );
}

export function filesToRevert(listed, revert) {
  return Array.isArray(revert) ? listed.filter((file) => revert.includes(file)) : [];
}

function fileList(files) {
  return files.map((file) => `- ${file}`).join("\n");
}

function unplannedFilesQuestion(files) {
  return `These changed files are named in no task document (spec, plan, design, repro or tests):
${fileList(files)}

Decide for each file whether to keep or revert it. Put the files to revert in revert, exactly as listed here, and give the reason for each decision in answer.`;
}

function revertInstructions(base, files) {
  return `The PO decided to revert these files, which no task document names:
${fileList(files)}

Restore each of them to its version on origin/${base}, and delete any of them that does not exist on origin/${base}. Change no other file. Commit the revert; every commit goes through the repo's hooks.`;
}

function matchableText(name, text) {
  return name === "spec.md" ? withoutDecisions(text) : text;
}

export function taskDocumentTexts(run) {
  return TASK_DOCUMENTS.filter((name) => existsSync(join(run.taskDir, name))).map(
    (name) => matchableText(name, readFileSync(join(run.taskDir, name), "utf8"))
  );
}

export function filesListedBefore(run) {
  return readEvents(run.env)
    .filter((event) => event.event === "unplanned_files" && event.task === run.id)
    .flatMap((event) => event.files ?? []);
}

function differsFromBase(run, file) {
  const result = run.effects.spawnTool(
    "git",
    ["diff", "--name-only", `origin/${run.base}`, "HEAD", "--", file],
    { cwd: run.worktree, env: run.env }
  );

  return result.status !== 0 || result.stdout.trim() !== "";
}

function stillDiffering(run, files) {
  return files.filter((file) => differsFromBase(run, file));
}

function recordUnplannedFiles(run, files, reverted) {
  appendEvent({ event: "unplanned_files", task: run.id, files, reverted }, run.env);
}

function stillDifferingMessage(base, differing) {
  if (differing.length === 0) return null;

  return `these files still differ from origin/${base} after the revert: ${differing.join(", ")}`;
}

function revertStop(ladderStop, differingMessage) {
  if (!differingMessage) return ladderStop;

  if (!ladderStop) return stuck(differingMessage);

  return stuck(`${ladderStop.message}; ${differingMessage}`);
}

function revertUnplannedFiles(run, listed, chosen) {
  const fixed = untilGreen(
    run,
    FIX_LADDER,
    revertInstructions(run.base, chosen),
    "unplanned-files"
  );
  if (fixed.waitingOn) return waiting(fixed.waitingOn);
  const stop = revertStop(
    fixStop(fixed, "the revert of unplanned files"),
    stillDifferingMessage(run.base, stillDiffering(run, chosen))
  );
  if (!stop) recordUnplannedFiles(run, listed, chosen);

  return stop;
}

function unplannedFilesStep(run) {
  const listed = unplannedFiles(
    run.effects.changedFilesSince(run.worktree, `origin/${run.base}`, run.env),
    taskDocumentTexts(run),
    filesListedBefore(run)
  );
  if (listed.length === 0) return null;
  const question = unplannedFilesQuestion(listed);
  const reply = askPo(run, UNPLANNED_FILES_ASKER, question);
  if (reply.userQuestion) return waiting(reply.userQuestion);
  appendDecision(
    run.id,
    { role: UNPLANNED_FILES_ASKER, question, answer: reply.answer },
    run.env
  );
  const chosen = filesToRevert(listed, reply.revert);
  if (chosen.length > 0) return revertUnplannedFiles(run, listed, chosen);
  recordUnplannedFiles(run, listed, []);

  return null;
}

function reviewFindingsStep(run, findings) {
  return guardedLadder(run, () => {
    const fixed = untilGreen(
      run,
      FIX_LADDER,
      `Fix these review findings:\n${JSON.stringify(findings, null, 2)}`,
      "review-findings"
    );

    return fixStop(fixed, "review findings");
  });
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
  enterSlot(run, "review");

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
  enterSlot(run, "tester");
  const tested = runRole(run, "tester", TESTER_INSTRUCTIONS);
  const stop = roleStop("tester", tested);
  if (stop) return stop;
  const unmet = unmetCriteria(tested);
  appendEvent({ event: "test", task: run.id, unmet: unmet.length }, run.env);

  if (unmet.length === 0) return null;

  return guardedLadder(run, () => {
    const fixed = untilGreen(
      run,
      FIX_LADDER,
      `The tester found unmet criteria in the running app:\n${JSON.stringify(unmet, null, 2)}`,
      "unmet-criteria"
    );

    return fixStop(fixed, "tester findings");
  });
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
  return guardedLadder(run, () => {
    const fixed = untilGreen(
      run,
      CI_FIX_LADDER,
      `CI failed on the pull request: ${ciSummary(ci)}. Read the failing logs with gh run view and fix the cause.`,
      "ci-failed"
    );

    return fixStop(fixed, "CI failures");
  });
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

  const reason = result.stderr.trim() || `exit ${result.status}`;

  return `${id}: ${reason}`;
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
  unplannedFilesStep,
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

export function worktreeFingerprint(run) {
  const dir = mkdtempSync(join(tmpdir(), "dark-factory-index-"));

  try {
    const options = {
      cwd: run.worktree,
      env: { ...run.env, GIT_INDEX_FILE: join(dir, "index") },
    };
    if (run.effects.spawnTool("git", ["add", "-A"], options).status !== 0) return null;
    const tree = run.effects.spawnTool("git", ["write-tree"], options);

    return tree.status === 0 ? tree.stdout.trim() : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  run.effects.startCoach(run.id, outcome.status, run.env);

  return { task: run.id, status: outcome.status, message, pr: run.pr ?? null };
}

export function runBuild(taskId, { env = process.env, effects = {} } = {}) {
  const run = {
    id: taskId,
    env,
    effects: { ...REAL_EFFECTS, ...effects },
    attempt: 0,
    testFixes: 0,
    testFixTrees: [],
    step: 0,
    beforeSlots: [],
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
