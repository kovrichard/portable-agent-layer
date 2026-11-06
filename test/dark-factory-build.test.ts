import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import { startCoach } from "../assets/plugins/dark-factory/scripts/coach.mjs";
import { appendEvent, taskDir } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { FACTORY_MODELS } from "../src/tools/dark-factory/stamp";
import {
  buildWorld,
  DEFAULT_CONFIG,
  eventsNamed,
  eventsOf,
  PR_URL,
  type RoleStep,
  storedTask,
  TASK,
  TESTS_COMMAND,
  type World,
} from "./lib/dark-factory-build-fixture";

const NOOP: RoleStep = { codes: false };
const NOISE = new Set(["role_finished", "gate_check", "handover", "plan_written"]);
const QUESTION = { done: false, summary: "", question: "which file?" };

type Options = Parameters<typeof buildWorld>[1];

function worldFor(options: Options = {}) {
  return buildWorld(import.meta.file, options);
}

function runBuild(world: World, taskId = TASK) {
  return build.runBuild(taskId, { env: world.env, effects: world.effects });
}

const roleNames = (world: World) => world.roleCalls.map((call) => call.role);

const flow = (world: World) =>
  eventsOf(world)
    .map((event) =>
      event.event === "role_run" ? `role:${event.role}` : String(event.event)
    )
    .filter((label) => !NOISE.has(label));

const writeWorktreeConfig = (world: World, config: object) =>
  writeFileSync(join(world.worktree, ".dark-factory.json"), JSON.stringify(config));

describe("the coach at the end of a run", () => {
  test("a waiting run is not coached", () => {
    const world = worldFor({
      roles: {
        "code-writer": [{ ...NOOP, reply: QUESTION }],
        po: [{ reply: { userQuestion: "Which database?" } }],
      },
    });
    world.effects.startCoach = startCoach;
    expect(runBuild(world).status).toBe("waiting");
    expect(eventsNamed(world, "coach_started")).toHaveLength(0);
  });

  test("the coach runs after the status is saved and the user is notified", () => {
    const world = worldFor();
    runBuild(world);
    const labels = flow(world);
    expect(labels.indexOf("notify")).toBeLessThan(labels.indexOf("coach_handed"));
    expect(labels.indexOf("task_status")).toBeLessThan(labels.indexOf("coach_handed"));
    expect(labels.indexOf("run_finished")).toBeLessThan(labels.indexOf("coach_handed"));
  });
});

describe("a whole feature run, in process", () => {
  test("runs the steps in order and ends ready with the pull request", () => {
    const world = worldFor({ category: "feature" });
    expect(runBuild(world)).toEqual({
      task: TASK,
      status: "ready",
      message: `Ready for your review: ${PR_URL}`,
      pr: PR_URL,
    });
    expect(roleNames(world)).toEqual([
      "planner",
      "test-writer",
      "code-writer",
      "reviewer",
      "tester",
    ]);
    expect(flow(world)).toEqual([
      "task_started",
      "role:planner",
      "role:test-writer",
      "tests_red",
      "role:code-writer",
      "gate",
      "step_done",
      "role:reviewer",
      "review",
      "step_done",
      "role:tester",
      "test",
      "step_done",
      "pr_ready",
      "task_status",
      "notify",
      "run_finished",
      "coach_handed",
    ]);
    expect(storedTask(world)).toMatchObject({ status: "ready", pr: PR_URL });
  });

  test("a tier sets the model, and a role without a tier leaves it to its agent", () => {
    const world = worldFor({ category: "feature" });
    runBuild(world);
    expect(
      Object.fromEntries(world.roleCalls.map((call) => [call.role, call.model]))
    ).toEqual({
      planner: undefined,
      "test-writer": undefined,
      "code-writer": FACTORY_MODELS.small,
      reviewer: undefined,
      tester: undefined,
    });
  });

  test("the red test proof logs the exit code and the failing count", () => {
    const world = worldFor({ category: "feature" });
    runBuild(world);
    expect(eventsNamed(world, "tests_red")).toEqual([
      expect.objectContaining({ task: TASK, exitCode: 1, failing: 2 }),
    ]);
  });

  test("the run ends with its totals summed from that run's role events", () => {
    const world = worldFor({ category: "feature" });
    runBuild(world);
    const finished = eventsNamed(world, "run_finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      task: TASK,
      status: "ready",
      roleRuns: 5,
      costUsd: 1.25,
      tokens: 675,
    });
    expect(typeof finished[0]?.wallMs).toBe("number");
  });
});

describe("handovers between roles", () => {
  const finding = { file: "a.ts", problem: "bad name", fix: "rename" };
  const handovers = (world: World) =>
    eventsNamed(world, "handover").map(
      (event) => `${event.from}->${event.to}:${event.reason}`
    );
  const payloadOf = (world: World, event: Record<string, unknown>) =>
    readFileSync(
      join(taskDir(TASK, world.env), (event.payload as { file: string }).file),
      "utf8"
    );

  test("every role start is a handover from the role before it, with its reason", () => {
    const world = worldFor({ roles: { reviewer: [{ reply: { findings: [finding] } }] } });
    runBuild(world);
    expect(handovers(world)).toEqual([
      "po->code-writer:pipeline",
      "code-writer->reviewer:pipeline",
      "reviewer->code-writer:review-findings",
      "code-writer->reviewer:pipeline",
    ]);
  });

  test("a gate retry is a handover for the failed gate", () => {
    const world = worldFor({ roles: { "code-writer": [NOOP] } });
    runBuild(world);
    expect(handovers(world).slice(0, 2)).toEqual([
      "po->code-writer:pipeline",
      "code-writer->code-writer:gate-failed",
    ]);
  });

  test("the payload is the instructions the role received, saved with its hash", () => {
    const world = worldFor({ roles: { reviewer: [{ reply: { findings: [finding] } }] } });
    runBuild(world);
    const fixRound = eventsNamed(world, "handover")[2] as Record<string, unknown>;
    const payload = fixRound.payload as { sha256: string; bytes: number };
    const text = payloadOf(world, fixRound);
    expect(text).toBe(world.roleCalls[2]?.instructions ?? "");
    expect(text).toContain("bad name");
    expect(payload.bytes).toBe(Buffer.byteLength(text));
    expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a question to the PO and its answer are both handovers", () => {
    const world = worldFor({
      roles: {
        "code-writer": [{ ...NOOP, reply: QUESTION }],
        po: [{ reply: { answer: "use a.ts" } }],
      },
    });
    runBuild(world);
    expect(handovers(world)).toContain("code-writer->po:question");
    expect(handovers(world)).toContain("po->code-writer:po-answer");
  });
});

describe("what the orchestrator runs itself", () => {
  const BUILD_SOURCE = join(
    import.meta.dir,
    "../assets/plugins/dark-factory/scripts/build.mjs"
  );

  test("it never spawns a process of its own, so claude only starts through role.mjs", () => {
    const source = readFileSync(BUILD_SOURCE, "utf8");
    expect(source).not.toContain("child_process");
    expect(source).not.toMatch(/Bun\.spawn/);
    expect(source).toContain("role.mjs");
  });

  test("an unknown task is a stuck result, not a crash", () => {
    const world = worldFor();
    expect(runBuild(world, "no-such-task")).toMatchObject({
      task: "no-such-task",
      status: "stuck",
    });
  });

  test("its tier models are the ones the factory stamps", () => {
    expect(build.TIER_MODELS).toEqual(FACTORY_MODELS);
  });
});

describe("the code ladder", () => {
  test("climbs haiku twice, sonnet twice, then the debugger on opus", () => {
    const world = worldFor({ roles: { "code-writer": [NOOP, NOOP, NOOP, NOOP] } });
    expect(runBuild(world).status).toBe("ready");
    expect(world.roleCalls.slice(0, 5).map((call) => [call.role, call.model])).toEqual([
      ["code-writer", FACTORY_MODELS.small],
      ["code-writer", FACTORY_MODELS.small],
      ["code-writer", FACTORY_MODELS.medium],
      ["code-writer", FACTORY_MODELS.medium],
      ["debugger", FACTORY_MODELS.large],
    ]);
    expect(
      eventsNamed(world, "escalation").map((event) => [event.from, event.to])
    ).toEqual([
      ["code-writer:small", "code-writer:medium"],
      ["code-writer:medium", "debugger:large"],
    ]);
    expect(eventsNamed(world, "gate").map((event) => event.result)).toEqual([
      "fail",
      "fail",
      "fail",
      "fail",
      "pass",
    ]);
  });

  test("the failing gate output goes to the next attempt", () => {
    const world = worldFor({ roles: { "code-writer": [NOOP] } });
    runBuild(world);
    expect(world.roleCalls[1]?.instructions).toContain(
      "The gate failed after the previous attempt"
    );
    expect(world.roleCalls[1]?.instructions).toContain("2 fail");
  });

  test("six failed attempts end the run stuck, with nothing shipped", () => {
    const world = worldFor({
      roles: { "code-writer": [NOOP, NOOP, NOOP, NOOP], debugger: [NOOP, NOOP] },
    });
    const result = runBuild(world);
    expect(result).toMatchObject({ status: "stuck", pr: null });
    expect(result.message).toContain("gate still fails after 6 attempts");
    expect(roleNames(world)).toHaveLength(6);
    expect(world.pushes).toBe(0);
    expect(storedTask(world).status).toBe("stuck");
  });
});

describe("review and test rounds", () => {
  const finding = { file: "a.ts", problem: "bad name", fix: "rename" };

  test("a finding is fixed on the sonnet rung and the reviewer looks again", () => {
    const world = worldFor({ roles: { reviewer: [{ reply: { findings: [finding] } }] } });
    expect(runBuild(world).status).toBe("ready");
    expect(roleNames(world)).toEqual([
      "code-writer",
      "reviewer",
      "code-writer",
      "reviewer",
    ]);
    expect(world.roleCalls[2]?.model).toBe(FACTORY_MODELS.medium);
    expect(world.roleCalls[2]?.instructions).toContain("bad name");
    expect(eventsNamed(world, "review").map((event) => event.findings)).toEqual([1, 0]);
  });

  test("the review stops after two rounds and the run still ships", () => {
    const findings = [finding];
    const world = worldFor({
      roles: { reviewer: [{ reply: { findings } }, { reply: { findings } }] },
    });
    expect(runBuild(world).status).toBe("ready");
    expect(roleNames(world)).toEqual([
      "code-writer",
      "reviewer",
      "code-writer",
      "reviewer",
      "code-writer",
    ]);
  });

  test("a reviewer that fails is stuck, not read as no findings", () => {
    const world = worldFor({ roles: { reviewer: [{ exit: 1, reply: {} }] } });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("reviewer failed");
    expect(world.pushes).toBe(0);
  });

  test("a diff that touches the UI adds the tester, and unmet criteria are fixed", () => {
    const unmet = { criterion: "export works", met: false, evidence: "blank" };
    const world = worldFor({
      config: { ...DEFAULT_CONFIG, uiPaths: ["ui/"] },
      roles: {
        "code-writer": [{ codes: true, changes: ["feature.txt", "ui/page.txt"] }],
        tester: [{ reply: { criteria: [unmet] } }],
      },
    });
    expect(runBuild(world).status).toBe("ready");
    expect(roleNames(world)).toEqual([
      "code-writer",
      "reviewer",
      "tester",
      "code-writer",
    ]);
    expect(eventsNamed(world, "roles_added")).toEqual([
      expect.objectContaining({ task: TASK, role: "tester" }),
    ]);
    expect(eventsNamed(world, "test")).toEqual([expect.objectContaining({ unmet: 1 })]);
    expect(world.roleCalls[3]?.model).toBe(FACTORY_MODELS.medium);
    expect(world.roleCalls[3]?.instructions).toContain("export works");
  });
});

describe("CI rounds", () => {
  const failing = (...checks: { name: string; link?: string }[]) => ({
    state: "fail",
    failed: checks,
  });
  const runLink = (id: number) => `https://github.com/o/r/actions/runs/${id}/job/9`;

  test("a CI that keeps failing gets one committed fix round, two reads, then ends stuck", () => {
    const world = worldFor({
      ci: [failing({ name: "ci", link: runLink(1) })],
      roles: { debugger: [{ commits: true }] },
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(roleNames(world)).toEqual(["code-writer", "reviewer", "debugger"]);
    expect(world.roleCalls[2]?.model).toBe(FACTORY_MODELS.large);
    expect(world.ciReads).toBe(2);
    expect(world.pushes).toBe(2);
    expect(world.reruns).toEqual([]);
  });

  test("a fix step that commits is pushed and CI is read again without a rerun", () => {
    const world = worldFor({
      ci: [failing({ name: "ci", link: runLink(1) }), { state: "pass", failed: [] }],
      roles: { debugger: [{ commits: true }] },
    });
    expect(runBuild(world).status).toBe("ready");
    expect(world.pushes).toBe(2);
    expect(world.reruns).toEqual([]);
    expect(eventsNamed(world, "ci_rerun")).toEqual([]);
  });

  test("a fix step that commits nothing reruns the failed run once and reads CI without pushing", () => {
    const world = worldFor({
      ci: [failing({ name: "ci", link: runLink(42) }), { state: "pass", failed: [] }],
      roles: { debugger: [NOOP] },
    });
    expect(runBuild(world).status).toBe("ready");
    expect(world.reruns).toHaveLength(1);
    expect(world.reruns[0]).toEqual(expect.arrayContaining(["run", "rerun", "--failed"]));
    expect(world.reruns[0]).toContain("42");
    expect(eventsNamed(world, "ci_rerun")).toEqual([
      expect.objectContaining({ task: TASK, ok: true }),
    ]);
    expect(world.pushes).toBe(1);
    expect(world.ciReads).toBe(2);
    expect(roleNames(world).filter((role) => role === "debugger")).toHaveLength(1);
  });

  test("each failed run is rerun once, taken from the failed checks' links", () => {
    const world = worldFor({
      ci: [
        failing(
          { name: "lint", link: runLink(11) },
          { name: "unit", link: runLink(22) },
          { name: "unit-2", link: runLink(22) }
        ),
        { state: "pass", failed: [] },
      ],
      roles: { debugger: [NOOP] },
    });
    runBuild(world);
    const ids = world.reruns.map((args) => args.find((arg) => /^\d+$/.test(arg)));
    expect(ids.sort()).toEqual(["11", "22"]);
  });

  test("CI still failing after the rerun ends stuck as external, naming the failed checks", () => {
    const world = worldFor({
      ci: [failing({ name: "flaky-suite", link: runLink(5) })],
      roles: { debugger: [NOOP] },
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("flaky-suite");
    expect(result.message).toContain("external");
    expect(world.reruns).toHaveLength(1);
    expect(world.ciReads).toBe(2);
    expect(roleNames(world).filter((role) => role === "debugger")).toHaveLength(1);
    expect(world.pushes).toBe(1);
  });

  test("a failing rerun command is recorded with ok false and ends stuck as external", () => {
    const world = worldFor({
      ci: [failing({ name: "flaky-suite", link: runLink(5) })],
      roles: { debugger: [NOOP] },
      rerunFails: true,
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("external");
    expect(eventsNamed(world, "ci_rerun")).toEqual([
      expect.objectContaining({ ok: false }),
    ]);
    expect(world.ciReads).toBe(1);
    expect(roleNames(world).filter((role) => role === "debugger")).toHaveLength(1);
  });

  test("a worktree HEAD that cannot be read after the fix ends stuck as could not read CI", () => {
    const world = worldFor({
      ci: [failing({ name: "ci", link: runLink(1) })],
      roles: { debugger: [NOOP] },
      headUnreadable: true,
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("could not read CI");
  });

  test("CI that cannot be read ends stuck with the gh error and starts no fix round", () => {
    const world = worldFor({ ciError: "HTTP 401: Bad credentials" });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("could not read CI");
    expect(result.message).toContain("HTTP 401");
    expect(roleNames(world)).toEqual(["code-writer", "reviewer"]);
  });
});

describe("questions go to the PO and the role continues", () => {
  test("the PO answers, the answer is recorded, and the same session resumes with it", () => {
    const world = worldFor({
      roles: {
        "code-writer": [{ ...NOOP, reply: QUESTION }],
        po: [{ reply: { answer: "use a.txt" } }],
      },
    });
    expect(runBuild(world).status).toBe("ready");
    expect(roleNames(world)).toEqual(["code-writer", "po", "code-writer", "reviewer"]);
    const [asked, po, resumed] = world.roleCalls;
    expect(po?.instructions).toContain("which file?");
    expect(resumed?.resumeSessionId).toBe("sess-code-writer-1");
    expect(resumed?.instructions).toContain("use a.txt");
    expect(asked?.resumeSessionId).toBeUndefined();
    const spec = readFileSync(join(taskDir(TASK, world.env), "spec.md"), "utf8");
    expect(spec).toMatch(/^- .*code-writer.*which file\?.*use a\.txt.*$/m);
    expect(eventsNamed(world, "po_question")).toEqual([
      expect.objectContaining({ role: "code-writer", toUser: false }),
    ]);
  });

  test("a question only the user can answer parks the task as waiting", () => {
    const world = worldFor({
      roles: {
        "code-writer": [{ ...NOOP, reply: QUESTION }],
        po: [{ reply: { userQuestion: "Which database?" } }],
      },
    });
    expect(runBuild(world)).toMatchObject({
      status: "waiting",
      message: "Which database?",
    });
    expect(roleNames(world)).toEqual(["code-writer", "po"]);
    expect(storedTask(world)).toMatchObject({
      status: "waiting",
      note: "Which database?",
    });
    expect(eventsNamed(world, "notify")).toEqual([
      expect.objectContaining({ kind: "waiting" }),
    ]);
    expect(eventsNamed(world, "question_to_user")).toHaveLength(1);
  });

  test("a rerun with commits ahead of the base skips the before roles", () => {
    const world = worldFor({ category: "feature", commitsAhead: 1 });
    writeFileSync(join(taskDir(TASK, world.env), "plan.md"), "plan\n");
    appendEvent(
      {
        event: "plan_written",
        task: TASK,
        specSha256: createHash("sha256")
          .update("# Add export\n\n## Goal\n\nExport.\n\n")
          .digest("hex"),
      },
      world.env
    );
    expect(runBuild(world).status).toBe("ready");
    expect(roleNames(world)).not.toContain("planner");
    expect(roleNames(world)).not.toContain("test-writer");
  });
});

describe("red tests", () => {
  test("tests that already pass are stuck, since they prove nothing", () => {
    const world = worldFor({
      category: "feature",
      roles: { "test-writer": [{ codes: true }] },
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("the new tests pass before the code exists");
    expect(eventsNamed(world, "tests_red")).toEqual([
      expect.objectContaining({ exitCode: 0 }),
    ]);
    expect(roleNames(world)).toEqual(["planner", "test-writer"]);
  });

  test("a gate with no check named tests is stuck with a message that says so", () => {
    const world = worldFor({
      category: "feature",
      config: { baseBranch: "canary", gate: [{ name: "lint", run: "lint" }] },
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain('no check named "tests"');
    expect(roleNames(world)).toEqual(["planner", "test-writer"]);
  });
});

describe("the config frozen by prepare", () => {
  const EXTRA_CHECK = { name: "extra", run: "check extra" };
  const TWO_CHECKS = { ...DEFAULT_CONFIG, gate: [...DEFAULT_CONFIG.gate, EXTRA_CHECK] };
  const failingExtra = { [EXTRA_CHECK.run]: () => ({ exitCode: 1, output: "no extra" }) };
  const gateCheckNames = (world: World) =>
    eventsNamed(world, "gate_check").map((event) => event.check);

  test("a role deleting a gate check from the worktree's config does not weaken the gate", () => {
    const world = worldFor({ config: TWO_CHECKS, checks: failingExtra });
    writeWorktreeConfig(world, DEFAULT_CONFIG);
    runBuild(world);
    expect(gateCheckNames(world).slice(0, 2)).toEqual(["tests", "extra"]);
    expect(eventsNamed(world, "gate").every((event) => event.result === "fail")).toBe(
      true
    );
  });

  test("the red-test proof uses the frozen config, not the worktree's", () => {
    const world = worldFor({ category: "feature" });
    writeWorktreeConfig(world, {
      ...DEFAULT_CONFIG,
      gate: [{ name: "tests", run: "passes" }],
    });
    runBuild(world);
    expect(world.checkCommands[0]).toBe(TESTS_COMMAND);
    expect(eventsNamed(world, "tests_red")).toEqual([
      expect.objectContaining({ exitCode: 1, failing: 2 }),
    ]);
  });

  test("the red-test proof still finds its check when the worktree's config loses it", () => {
    const world = worldFor({ category: "feature" });
    writeWorktreeConfig(world, { ...DEFAULT_CONFIG, gate: [] });
    const result = runBuild(world);
    expect(result.message).not.toContain('no check named "tests"');
    expect(eventsNamed(world, "tests_red")).toHaveLength(1);
  });

  test("the roles after the diff use the frozen uiPaths, not the worktree's", () => {
    const world = worldFor({
      config: { ...DEFAULT_CONFIG, uiPaths: ["ui/"] },
      roles: { "code-writer": [{ codes: true, changes: ["ui/page.txt"] }] },
    });
    writeWorktreeConfig(world, DEFAULT_CONFIG);
    runBuild(world);
    expect(roleNames(world)).toContain("tester");
    expect(eventsNamed(world, "roles_added")).toEqual([
      expect.objectContaining({ task: TASK, role: "tester" }),
    ]);
  });
});

describe("the reviewer is told when the config changes", () => {
  const reviewerInstructions = (world: World) =>
    world.roleCalls.find((call) => call.role === "reviewer")?.instructions;

  test("a diff that touches .dark-factory.json is flagged in the reviewer's instructions", () => {
    const world = worldFor({
      roles: { "code-writer": [{ codes: true, changes: [".dark-factory.json"] }] },
    });
    runBuild(world);
    const text = reviewerInstructions(world) ?? "";
    expect(text).toContain(".dark-factory.json");
    expect(text).toMatch(/finding/i);
  });

  test("a diff that does not touch it carries no such note", () => {
    const world = worldFor();
    runBuild(world);
    expect(reviewerInstructions(world)).toBeDefined();
    expect(reviewerInstructions(world)).not.toContain(".dark-factory.json");
  });
});

describe("failingTestCount", () => {
  test("reads bun, jest and vitest summaries", () => {
    expect(build.failingTestCount(" 5 pass\n 3 fail\nRan 8 tests")).toBe(3);
    expect(build.failingTestCount("Tests:       2 failed, 5 passed, 7 total")).toBe(2);
    expect(build.failingTestCount(" Tests  1 failed | 4 passed (5)")).toBe(1);
  });

  test("the last summary line wins", () => {
    expect(build.failingTestCount("1 fail\nmore output\n4 fail")).toBe(4);
  });

  test("a runner it does not know gives null", () => {
    expect(build.failingTestCount("all done")).toBeNull();
  });
});

describe("runTotals", () => {
  const finished = (extra: object) => ({
    event: "role_finished",
    task: TASK,
    ts: "2026-10-20T10:00:05.000Z",
    costUsd: 0.5,
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    ...extra,
  });

  test("sums this task's role runs since the run started, treating nulls as zero", () => {
    const totals = build.runTotals(
      [
        finished({}),
        finished({ costUsd: null, inputTokens: null }),
        finished({ ts: "2026-10-20T09:00:00.000Z" }),
        finished({ task: "other" }),
        { event: "gate", task: TASK, ts: "2026-10-20T10:00:06.000Z" },
      ],
      TASK,
      "2026-10-20T10:00:00.000Z"
    );
    expect(totals).toEqual({ costUsd: 0.5, tokens: 19, roleRuns: 2 });
  });
});
