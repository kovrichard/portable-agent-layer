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
const NOISE = new Set([
  "role_finished",
  "gate_check",
  "handover",
  "plan_written",
  "unit_tests_done",
]);
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

describe("a build restarts a ready task", () => {
  test("a ready task reads back running with one task_started once the build has started", () => {
    const world = worldFor({
      status: "ready",
      roles: { "code-writer": [{ ...NOOP, reply: QUESTION }] },
    });
    const seen: unknown[] = [];
    const original = world.effects.runRoleHeadless as (...args: unknown[]) => unknown;
    world.effects.runRoleHeadless = (...args: unknown[]) => {
      seen.push({
        status: storedTask(world).status,
        started: eventsNamed(world, "task_started").length,
      });
      return original(...args);
    };
    runBuild(world);
    expect(seen[0]).toEqual({ status: "running", started: 1 });
    expect(eventsNamed(world, "task_started")).toHaveLength(1);
  });

  test("a draft task still gets exactly one task_started and running", () => {
    const world = worldFor();
    runBuild(world);
    expect(eventsNamed(world, "task_started")).toHaveLength(1);
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
      "test-writer",
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
      "reviewer",
      "tester",
    ]);
    expect(flow(world)).toEqual([
      "task_started",
      "estimate",
      "role:test-writer",
      "tests_red",
      "role:planner",
      "role:reviewer",
      "plan_gate",
      "role:test-writer",
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
      "run_finished",
      "notify",
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
      "test-writer": FACTORY_MODELS.small,
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
      roleRuns: 7,
      costUsd: 1.75,
      tokens: 945,
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
    writeFileSync(join(taskDir(TASK, world.env), "plan.md"), "feature.txt\nui/\n");
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

describe("unplanned files on resume", () => {
  test("a revert that stopped waiting is asked again on the resumed run", () => {
    const world = worldFor({
      roles: {
        po: [
          { reply: { answer: "revert one.ts", revert: ["one.ts"] } },
          { reply: { userQuestion: "Which file?" } },
          { reply: { answer: "keep one.ts" } },
        ],
        "code-writer": [{ codes: true }, { reply: QUESTION }],
      },
    });
    world.changedFiles.push("one.ts");
    expect(runBuild(world).status).toBe("waiting");
    expect(eventsNamed(world, "unplanned_files")).toHaveLength(0);
    runBuild(world);
    const questions = world.roleCalls.filter(
      (call) =>
        call.role === "po" && call.instructions?.includes("named in no task document")
    );
    expect(questions).toHaveLength(2);
    expect(questions[1]?.instructions).toContain("one.ts");
    expect(eventsNamed(world, "unplanned_files")).toEqual([
      expect.objectContaining({ files: ["one.ts"], reverted: [] }),
    ]);
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

  test("the read after a rerun treats the failed links from before the rerun as the old attempt", () => {
    const world = worldFor({
      ci: [
        failing({ name: "flaky-suite", link: runLink(5) }),
        { state: "pass", failed: [] },
      ],
      roles: { debugger: [NOOP] },
    });
    expect(runBuild(world).status).toBe("ready");
    expect(world.ciOptions[0]?.staleLinks).toBeUndefined();
    expect(world.ciOptions[1]).toMatchObject({ staleLinks: [runLink(5)] });
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

  test("an unreadable worktree HEAD around the fix step ends stuck without pushing again", () => {
    const world = worldFor({
      ci: [failing({ name: "ci", link: runLink(1) })],
      roles: { debugger: [{ commits: true }] },
      gitHeadUnreadable: true,
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("could not read CI: worktree HEAD unreadable");
    expect(world.pushes).toBe(1);
    expect(world.reruns).toEqual([]);
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
    expect(roleNames(world)).toEqual(["test-writer"]);
  });

  test("a gate with no check named tests is stuck with a message that says so", () => {
    const world = worldFor({
      category: "feature",
      config: { baseBranch: "canary", gate: [{ name: "lint", run: "lint" }] },
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain('no check named "tests"');
    expect(roleNames(world)).toEqual(["test-writer"]);
  });
});

describe("acceptance tests before the plan", () => {
  const callsOf = (world: World, role: string) =>
    world.roleCalls.filter((call) => call.role === role);

  test("a feature run is test writer, planner, plan gate, unit typist, code writer", () => {
    const world = worldFor({ category: "feature" });
    runBuild(world);
    expect(roleNames(world).slice(0, 5)).toEqual([
      "test-writer",
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
    ]);
  });

  test("a big-feature run starts architect, test writer, planner", () => {
    const world = worldFor({ category: "big-feature" });
    runBuild(world);
    expect(roleNames(world).slice(0, 3)).toEqual(["architect", "test-writer", "planner"]);
    const labels = flow(world);
    expect(labels.indexOf("tests_red")).toBeGreaterThan(-1);
    expect(labels.indexOf("tests_red")).toBeLessThan(labels.indexOf("role:planner"));
  });

  test("the first test writer works from spec.md only and writes tests.md", () => {
    const world = worldFor({ category: "feature" });
    runBuild(world);
    const instructions = callsOf(world, "test-writer")[0]?.instructions ?? "";
    expect(instructions).toContain("spec.md only");
    expect(instructions).toContain("tests.md");
  });

  test("the first planner is told the failing tests in tests.md exist and must pass unchanged", () => {
    const world = worldFor({ category: "feature" });
    runBuild(world);
    expect(callsOf(world, "planner")[0]?.instructions ?? "").toContain("tests.md");
  });

  test("a bug run keeps its test writer's instructions and runs no typist", () => {
    const world = worldFor({
      category: "bug",
      roles: { debugger: [{ codes: false }] },
    });
    runBuild(world);
    expect(roleNames(world).slice(0, 3)).toEqual([
      "debugger",
      "test-writer",
      "code-writer",
    ]);
    expect(callsOf(world, "test-writer")[0]?.instructions ?? "").not.toContain(
      "spec.md only"
    );
    expect(callsOf(world, "test-writer")).toHaveLength(1);
  });

  test("a refactor run's planner gets today's instructions and no typist", () => {
    const world = worldFor({ category: "refactor" });
    runBuild(world);
    expect(callsOf(world, "planner")[0]?.instructions).toBe(
      "Write plan.md for this change."
    );
    expect(roleNames(world)).not.toContain("test-writer");
  });
});

describe("the unit typist", () => {
  const typist = (world: World) =>
    world.roleCalls.filter((call) => call.role === "test-writer")[1];

  test("a typist that adds files runs on the small model and the red proof runs again", () => {
    const world = worldFor({
      category: "feature",
      roles: { "test-writer": [{}, { leavesChanges: true }] },
      checks: {
        [TESTS_COMMAND]: (w) =>
          [
            { exitCode: 1, output: " 2 fail" },
            { exitCode: 1, output: " 2 fail" },
            { exitCode: 1, output: " 4 fail" },
          ][w.checkCommands.length - 1] ?? { exitCode: 0, output: " 3 pass" },
      },
    });
    const result = runBuild(world);
    expect(typist(world)?.model).toBe(build.TIER_MODELS.small);
    expect(eventsNamed(world, "tests_red")).toHaveLength(2);
    expect(result.status).toBe("ready");
  });

  test("a typist that changes nothing gets no second red proof and the code step runs", () => {
    const world = worldFor({ category: "feature" });
    runBuild(world);
    expect(eventsNamed(world, "tests_red")).toHaveLength(1);
    expect(roleNames(world).slice(3, 5)).toEqual(["test-writer", "code-writer"]);
  });

  test("the typist's instructions", () => {
    const world = worldFor({ category: "feature" });
    runBuild(world);
    const instructions = typist(world)?.instructions ?? "";
    for (const text of [
      "example table",
      "plan.md",
      "change no other file",
      "uncommitted",
      "change nothing",
    ])
      expect(instructions).toContain(text);
  });

  test("a typist that leaves the tests passing is stuck as the red proof says", () => {
    const world = worldFor({
      category: "feature",
      roles: { "test-writer": [{}, { leavesChanges: true, codes: true }] },
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("the new tests pass before the code exists");
    expect(roleNames(world)).not.toContain("code-writer");
  });

  test("an unreadable git status around the typist runs the red proof", () => {
    const world = worldFor({ category: "feature" });
    const original = world.effects.spawnTool as (
      command: string,
      args: string[]
    ) => unknown;
    world.effects.spawnTool = (command: string, args: string[]) =>
      args[0] === "status" || args[0] === "write-tree"
        ? { status: 128, stdout: "", stderr: "fatal" }
        : original(command, args);
    runBuild(world);
    expect(eventsNamed(world, "tests_red")).toHaveLength(3);
  });

  test("a failing unit typist is stuck as test-writer failed", () => {
    const world = worldFor({
      category: "feature",
      roles: { "test-writer": [{}, { exit: 1 }] },
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("test-writer failed");
  });
});

describe("the unit typist must raise the failing count", () => {
  const failOutput = (count: number, pad = "") => `${pad} 1 pass\n ${count} fail`;
  const failRun = (count: number, pad = "") => ({
    exitCode: 1,
    output: failOutput(count, pad),
  });
  type Run = { exitCode: number; output: string };

  function sequenced(runs: Run[]) {
    return {
      [TESTS_COMMAND]: (world: World): Run =>
        runs[world.checkCommands.length - 1] ?? { exitCode: 0, output: " 3 pass" },
    };
  }

  function worldWithCounts(runs: Run[], typistStep: object = { leavesChanges: true }) {
    return worldFor({
      category: "feature",
      roles: { "test-writer": [{}, typistStep] },
      checks: sequenced(runs),
    });
  }

  const acceptance = failRun(2);
  const unitDone = (world: World) => eventsNamed(world, "unit_tests_done");

  test("the tests check runs once before the typist and once after it", () => {
    const world = worldWithCounts([acceptance, failRun(3), failRun(4)]);
    const original = world.effects.runRoleHeadless as (
      taskId: string,
      role: string,
      args: object
    ) => unknown;
    const checksAtTypistStart: number[] = [];
    let testWriterRuns = 0;
    world.effects.runRoleHeadless = (taskId: string, role: string, args: object) => {
      if (role === "test-writer" && ++testWriterRuns === 2)
        checksAtTypistStart.push(world.checkCommands.length);
      return original(taskId, role, args);
    };
    runBuild(world);
    expect(checksAtTypistStart).toEqual([2]);
    expect(world.checkCommands.slice(0, 3)).toEqual([
      TESTS_COMMAND,
      TESTS_COMMAND,
      TESTS_COMMAND,
    ]);
  });

  test("baseline 3 and after 4 proves the rise and goes on to unit_tests_done", () => {
    const world = worldWithCounts([acceptance, failRun(3), failRun(4)]);
    const result = runBuild(world);
    expect(result.status).toBe("ready");
    expect(unitDone(world)).toHaveLength(1);
    expect(roleNames(world)).toContain("code-writer");
  });

  test("the typist's tests_red event records the baseline", () => {
    const world = worldWithCounts([acceptance, failRun(3), failRun(4)]);
    runBuild(world);
    expect(eventsNamed(world, "tests_red").at(-1)).toEqual(
      expect.objectContaining({ task: TASK, exitCode: 1, failing: 4, baseline: 3 })
    );
  });

  test("the same count after the typist is stuck, naming both counts and the output tail", () => {
    const world = worldWithCounts([
      acceptance,
      failRun(7),
      failRun(7),
      failRun(7, "AFTERRUN"),
    ]);
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("7");
    expect(result.message).toContain("AFTERRUN");
    expect(unitDone(world)).toHaveLength(0);
    expect(roleNames(world)).not.toContain("code-writer");
  });

  test("a lower count after the typist is stuck, naming both counts", () => {
    const world = worldWithCounts([acceptance, failRun(7), failRun(7), failRun(5)]);
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toMatch(/\b7\b/);
    expect(result.message).toMatch(/\b5\b/);
    expect(unitDone(world)).toHaveLength(0);
  });

  test("the stuck message carries only the last FAILURE_TAIL characters of the output", () => {
    const longRun = {
      exitCode: 1,
      output: `HEADMARK${"x".repeat(5000)}TAILMARK\n 3 fail`,
    };
    const world = worldWithCounts([acceptance, failRun(3), failRun(3), longRun]);
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("TAILMARK");
    expect(result.message).not.toContain("HEADMARK");
  });

  test("a baseline of 0 failures lets any failing test after the typist prove the rise", () => {
    const world = worldWithCounts([
      acceptance,
      { exitCode: 0, output: " 5 pass" },
      failRun(1),
    ]);
    const result = runBuild(world);
    expect(result.status).toBe("ready");
    expect(unitDone(world)).toHaveLength(1);
    expect(eventsNamed(world, "tests_red").at(-1)).toEqual(
      expect.objectContaining({ baseline: 0, failing: 1 })
    );
  });

  test("a file that fails to load keeps the count flat and the message says it counts as one failure", () => {
    const world = worldWithCounts([acceptance, failRun(1), failRun(1), failRun(1)]);
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toMatch(/fail(s|ing)? to load/i);
    expect(result.message).toMatch(/one failure/i);
  });

  test("a baseline with no failing count stops stuck before the typist runs", () => {
    const world = worldWithCounts([
      acceptance,
      { exitCode: 1, output: "segfault, no summary" },
    ]);
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("reported no failing test count");
    expect(world.roleCalls.filter((call) => call.role === "test-writer")).toHaveLength(1);
    expect(unitDone(world)).toHaveLength(0);
  });

  test("a typist that leaves the worktree unchanged runs only the baseline and finishes", () => {
    const world = worldWithCounts([acceptance, failRun(3), failRun(3)], {});
    const original = world.effects.runRoleHeadless as (
      taskId: string,
      role: string,
      args: object
    ) => unknown;
    const checksWhenCodeWriterStarts: number[] = [];
    world.effects.runRoleHeadless = (taskId: string, role: string, args: object) => {
      if (role === "code-writer")
        checksWhenCodeWriterStarts.push(world.checkCommands.length);
      return original(taskId, role, args);
    };
    const result = runBuild(world);
    expect(result.status).toBe("ready");
    expect(checksWhenCodeWriterStarts[0]).toBe(2);
    expect(unitDone(world)).toHaveLength(1);
    expect(eventsNamed(world, "tests_red")).toHaveLength(1);
  });

  test("a typist that edits a file the acceptance tests already modified still gets the proof", () => {
    const world = worldFor({
      category: "feature",
      roles: { "test-writer": [{ leavesChanges: true }, { editsModifiedFile: true }] },
      checks: sequenced([acceptance, failRun(3), failRun(4)]),
    });
    const original = world.effects.runRoleHeadless as (
      taskId: string,
      role: string,
      args: object
    ) => unknown;
    const spawn = world.effects.spawnTool as (
      command: string,
      args: string[]
    ) => { stdout: string };
    const read = (args: string[]) => spawn("git", args).stdout;
    const snapshots: { porcelain: string[]; tree: string[] } = {
      porcelain: [],
      tree: [],
    };
    let typistCalls = 0;
    world.effects.runRoleHeadless = (taskId: string, role: string, args: object) => {
      if (role !== "test-writer" || ++typistCalls !== 2)
        return original(taskId, role, args);
      snapshots.porcelain.push(read(["status", "--porcelain"]));
      snapshots.tree.push(read(["write-tree"]));
      const outcome = original(taskId, role, args);
      snapshots.porcelain.push(read(["status", "--porcelain"]));
      snapshots.tree.push(read(["write-tree"]));
      return outcome;
    };
    const result = runBuild(world);
    expect(snapshots.porcelain).toHaveLength(2);
    expect(snapshots.porcelain[0]).not.toBe("");
    expect(snapshots.porcelain[1]).toBe(snapshots.porcelain[0]);
    expect(snapshots.tree[1]).not.toBe(snapshots.tree[0]);
    expect(eventsNamed(world, "tests_red")).toHaveLength(2);
    expect(eventsNamed(world, "tests_red").at(-1)).toEqual(
      expect.objectContaining({ failing: 4, baseline: 3 })
    );
    expect(result.status).toBe("ready");
  });

  test("an edit to an already-modified file that does not raise the count is stuck", () => {
    const world = worldFor({
      category: "feature",
      roles: { "test-writer": [{ leavesChanges: true }, { editsModifiedFile: true }] },
      checks: sequenced([acceptance, failRun(3), failRun(3), failRun(3)]),
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(unitDone(world)).toHaveLength(0);
  });

  test("a resume that owes the typist also takes the baseline before it", () => {
    const world = worldFor({
      category: "feature",
      roles: { "test-writer": [{ leavesChanges: true }] },
      checks: sequenced([failRun(3), failRun(3), failRun(3)]),
    });
    writeFileSync(join(taskDir(TASK, world.env), "plan.md"), "plan\n");
    appendEvent(
      { event: "tests_red", task: TASK, exitCode: 1, failing: 2 } as never,
      world.env
    );
    appendEvent(
      {
        event: "plan_written",
        task: TASK,
        specSha256: createHash("sha256")
          .update("# Add export\n\n## Goal\n\nExport.\n\n")
          .digest("hex"),
      } as never,
      world.env
    );
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(unitDone(world)).toHaveLength(0);
    expect(world.checkCommands.length).toBe(3);
  });

  const missingCountHead =
    "the test run failed but reported no failing test count, so it does not prove the new tests fail:";
  const noRiseHead = (baseline: number, failing: number) =>
    `the unit tests did not raise the failing test count (${baseline} before the typist, ${failing} after), so they prove nothing; a test file that fails to load counts as one failure, however many tests it holds:`;

  test("a baseline output of 'segfault, no summary' is named in the missing-count message", () => {
    const world = worldWithCounts([
      acceptance,
      { exitCode: 1, output: "segfault, no summary" },
    ]);
    expect(runBuild(world).message).toBe(`${missingCountHead}\nsegfault, no summary`);
    expect(world.roleCalls.filter((call) => call.role === "test-writer")).toHaveLength(1);
  });

  test("an empty baseline output gives the missing-count message with nothing after it", () => {
    const world = worldWithCounts([acceptance, { exitCode: 1, output: "" }]);
    expect(runBuild(world).message).toBe(`${missingCountHead}\n`);
    expect(world.roleCalls.filter((call) => call.role === "test-writer")).toHaveLength(1);
  });

  test("a baseline output of 1501 characters keeps only its last 1500 in the missing-count message", () => {
    const world = worldWithCounts([
      acceptance,
      { exitCode: 1, output: `A${"x".repeat(1500)}` },
    ]);
    expect(runBuild(world).message).toBe(`${missingCountHead}\n${"x".repeat(1500)}`);
    expect(world.roleCalls.filter((call) => call.role === "test-writer")).toHaveLength(1);
  });

  test("baseline 7 and after 7 with ' 1 pass\\n 7 fail' gives the no-rise message with that output", () => {
    const world = worldWithCounts([acceptance, failRun(7), failRun(7), failRun(7)]);
    expect(runBuild(world).message).toBe(`${noRiseHead(7, 7)}\n 1 pass\n 7 fail`);
  });

  test("baseline 7 and after 5 with ' 5 fail' gives the no-rise message with that output", () => {
    const world = worldWithCounts([
      acceptance,
      failRun(7),
      failRun(7),
      { exitCode: 1, output: " 5 fail" },
    ]);
    expect(runBuild(world).message).toBe(`${noRiseHead(7, 5)}\n 5 fail`);
  });

  test("baseline 3 and after 3 with a 1500-character tail keeps only that tail, not the head", () => {
    const output = `HEAD${"x".repeat(1500)}\n 3 fail`;
    const world = worldWithCounts([
      acceptance,
      failRun(3),
      failRun(3),
      { exitCode: 1, output },
    ]);
    expect(runBuild(world).message).toBe(`${noRiseHead(3, 3)}\n${output.slice(-1500)}`);
  });

  test("a baseline run that exits 0 with ' 5 pass' counts as a baseline of 0", () => {
    const world = worldWithCounts([
      acceptance,
      { exitCode: 0, output: " 5 pass" },
      failRun(1),
    ]);
    expect(runBuild(world).status).toBe("ready");
    expect(eventsNamed(world, "tests_red").at(-1)).toEqual(
      expect.objectContaining({ baseline: 0 })
    );
  });

  test("a baseline run that exits 0 with ' 1 pass\\n 2 fail' counts as a baseline of 0", () => {
    const world = worldWithCounts([
      acceptance,
      { exitCode: 0, output: " 1 pass\n 2 fail" },
      failRun(1),
    ]);
    expect(runBuild(world).status).toBe("ready");
    expect(eventsNamed(world, "tests_red").at(-1)).toEqual(
      expect.objectContaining({ baseline: 0 })
    );
  });

  test("a baseline run that exits 1 with ' 1 pass\\n 3 fail' counts as a baseline of 3", () => {
    const world = worldWithCounts([acceptance, failRun(3), failRun(4)]);
    expect(runBuild(world).status).toBe("ready");
    expect(eventsNamed(world, "tests_red").at(-1)).toEqual(
      expect.objectContaining({ baseline: 3 })
    );
  });

  test("a baseline run that exits 1 with ' 0 fail' counts as a baseline of 0", () => {
    const world = worldWithCounts([
      acceptance,
      { exitCode: 1, output: " 0 fail" },
      failRun(1),
    ]);
    expect(runBuild(world).status).toBe("ready");
    expect(eventsNamed(world, "tests_red").at(-1)).toEqual(
      expect.objectContaining({ baseline: 0 })
    );
  });

  test("a baseline run that exits 1 with 'segfault, no summary' stops stuck before the typist", () => {
    const world = worldWithCounts([
      acceptance,
      { exitCode: 1, output: "segfault, no summary" },
    ]);
    expect(runBuild(world).status).toBe("stuck");
    expect(world.roleCalls.filter((call) => call.role === "test-writer")).toHaveLength(1);
  });
});

describe("a rerun before the first code step", () => {
  const SPEC_HASH = createHash("sha256")
    .update("# Add export\n\n## Goal\n\nExport.\n\n")
    .digest("hex");
  const redProof = { event: "tests_red", task: TASK, exitCode: 1, failing: 2 };

  function worldWithPlan(events: object[]) {
    const world = worldFor({ category: "feature" });
    writeFileSync(join(taskDir(TASK, world.env), "plan.md"), "plan\n");
    for (const event of events) appendEvent(event as never, world.env);
    return world;
  }

  test("a plan written but unit typist not finished runs the plan gate and the typist", () => {
    const world = worldWithPlan([
      redProof,
      { event: "plan_written", task: TASK, specSha256: SPEC_HASH },
    ]);
    runBuild(world);
    expect(roleNames(world).slice(0, 3)).toEqual([
      "reviewer",
      "test-writer",
      "code-writer",
    ]);
  });

  test("a finished unit typist is not run again", () => {
    const world = worldWithPlan([
      redProof,
      { event: "plan_written", task: TASK, specSha256: SPEC_HASH },
      { event: "unit_tests_done", task: TASK },
    ]);
    runBuild(world);
    expect(roleNames(world)[0]).toBe("code-writer");
  });

  test("tests proved red but no plan yet runs the planner, gate and typist", () => {
    const world = worldFor({ category: "feature" });
    appendEvent(redProof as never, world.env);
    runBuild(world);
    expect(roleNames(world).slice(0, 4)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
    ]);
  });
});

describe("worktreeStatusChanged", () => {
  const rows: [string | null, string | null, boolean][] = [
    ["", "", false],
    ["", "?? a.test.ts", true],
    ["?? a.test.ts", "?? a.test.ts", false],
    ["?? a.test.ts", "?? a.test.ts\n?? b.test.ts", true],
    [null, "", true],
    ["", null, true],
    [null, null, true],
  ];
  for (const [before, after, changed] of rows)
    test(`${JSON.stringify(before)} → ${JSON.stringify(after)} is ${changed}`, () => {
      expect(build.worktreeStatusChanged(before, after)).toBe(changed);
    });
});

describe("worktreeFingerprint", () => {
  type Worktree = {
    files: Record<string, string>;
    addStatus: number;
    writeTreeStatus: number;
  };

  const fakeRun = (worktree: Worktree) => {
    const spawnTool = (command: string, args: string[]) => {
      if (args[0] === "add")
        return { status: worktree.addStatus, stdout: "", stderr: "" };
      if (args[0] === "write-tree") {
        const tree = createHash("sha1")
          .update(JSON.stringify(worktree.files))
          .digest("hex");
        return { status: worktree.writeTreeStatus, stdout: `${tree}\n`, stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected ${command}` };
    };
    return { worktree: "/fake/worktree", env: {}, effects: { spawnTool } };
  };

  const fresh = (files: Record<string, string> = { "a.test.ts": "old" }): Worktree => ({
    files,
    addStatus: 0,
    writeTreeStatus: 0,
  });

  test("the same worktree gives the same tree id both times", () => {
    const run = fakeRun(fresh());
    const first = build.worktreeFingerprint(run);
    expect(first).not.toBeNull();
    expect(build.worktreeFingerprint(run)).toBe(first);
  });

  test("editing a file that is already modified gives a different tree id", () => {
    const worktree = fresh();
    const run = fakeRun(worktree);
    const before = build.worktreeFingerprint(run);
    worktree.files["a.test.ts"] = "new";
    expect(build.worktreeFingerprint(run)).not.toBe(before);
  });

  test("a new untracked file gives a different tree id", () => {
    const worktree = fresh();
    const run = fakeRun(worktree);
    const before = build.worktreeFingerprint(run);
    worktree.files["new.test.ts"] = "added";
    expect(build.worktreeFingerprint(run)).not.toBe(before);
  });

  test("git add -A or git write-tree exiting non-zero gives null", () => {
    expect(build.worktreeFingerprint(fakeRun({ ...fresh(), addStatus: 1 }))).toBeNull();
    expect(
      build.worktreeFingerprint(fakeRun({ ...fresh(), writeTreeStatus: 1 }))
    ).toBeNull();
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

describe("unplannedFiles", () => {
  test("lists a changed file that no document names", () => {
    expect(
      build.unplannedFiles(
        ["src/named.ts", "src/stray.ts"],
        ["Edit src/named.ts only.\n"],
        []
      )
    ).toEqual(["src/stray.ts"]);
  });

  test("a file under a directory named with a slash, and a file under a deeper named directory, are both named", () => {
    expect(
      build.unplannedFiles(
        ["test/a.test.ts", "src/deep/b.ts"],
        ["tests live in test/ and src/deep/\n"],
        []
      )
    ).toEqual([]);
  });

  test("a file whose full path is in a document is not listed, and a sibling file in the same directory is", () => {
    expect(
      build.unplannedFiles(
        ["test/a.test.ts", "test/other.test.ts"],
        ["Add test/a.test.ts\n"],
        []
      )
    ).toEqual(["test/other.test.ts"]);
  });

  test("matching is case-sensitive", () => {
    expect(build.unplannedFiles(["src/Thing.ts"], ["src/thing.ts\n"], [])).toEqual([
      "src/Thing.ts",
    ]);
  });

  test("a file listed before is not listed again", () => {
    expect(build.unplannedFiles(["old.ts", "new.ts"], [], ["old.ts"])).toEqual([
      "new.ts",
    ]);
  });

  test("bun.lock gets no exemption", () => {
    expect(build.unplannedFiles(["bun.lock"], ["run bun install\n"], [])).toEqual([
      "bun.lock",
    ]);
  });

  test("a glob that mentions a directory's files does not name a file in it", () => {
    expect(
      build.unplannedFiles(["test/x.test.ts"], ["see `test/*.test.ts`\n"], [])
    ).toEqual([]);
  });

  test("a directory followed by a slash in prose names its files", () => {
    expect(
      build.unplannedFiles(["test/x.test.ts"], ["tests live in test/\n"], [])
    ).toEqual([]);
  });

  test("a directory mentioned in prose names the files under it", () => {
    expect(
      build.unplannedFiles(["test/lib/x.ts"], ["tests live in test/ only\n"], [])
    ).toEqual([]);
  });

  test("a different file in a named file's directory is still listed", () => {
    expect(build.unplannedFiles(["test/lib/b.ts"], ["Add test/lib/a.ts\n"], [])).toEqual([
      "test/lib/b.ts",
    ]);
  });

  test("a directory followed by a slash at the end of a sentence names its files", () => {
    expect(build.unplannedFiles(["test/x.ts"], ["files under test/.\n"], [])).toEqual([
      "test/x.ts",
    ]);
  });

  test("no changed files gives no listed files", () => {
    expect(build.unplannedFiles([], ["anything"], [])).toEqual([]);
  });
});

describe("filesToRevert", () => {
  test("returns the listed file that revert names", () => {
    expect(build.filesToRevert(["one.ts", "two.ts"], ["one.ts"])).toEqual(["one.ts"]);
  });

  test("ignores a revert entry that is not among the listed files", () => {
    expect(build.filesToRevert(["one.ts"], ["two.ts", "ghost.ts"])).toEqual([]);
  });

  test("keeps only the listed files that revert names, when revert also names an unlisted file", () => {
    expect(build.filesToRevert(["one.ts", "two.ts"], ["one.ts", "ghost.ts"])).toEqual([
      "one.ts",
    ]);
  });

  test("an undefined revert keeps every listed file", () => {
    expect(build.filesToRevert(["one.ts", "two.ts"], undefined)).toEqual([]);
  });

  test("an empty revert keeps every listed file", () => {
    expect(build.filesToRevert(["one.ts", "two.ts"], [])).toEqual([]);
  });

  test("returns the reverted files in listed order, not revert order", () => {
    expect(build.filesToRevert(["one.ts", "two.ts"], ["two.ts", "one.ts"])).toEqual([
      "one.ts",
      "two.ts",
    ]);
  });
});

describe("isTestFile", () => {
  test("a .test. file with no testPaths is a test file", () => {
    expect(build.isTestFile("src/a.test.ts", undefined)).toBe(true);
  });

  test("a .spec. file with no testPaths is a test file", () => {
    expect(build.isTestFile("src/b.spec.js", undefined)).toBe(true);
  });

  test("a file in a test directory with no testPaths is a test file", () => {
    expect(build.isTestFile("test/helper.ts", undefined)).toBe(true);
  });

  test("a non-code file in a tests directory is a test file", () => {
    expect(build.isTestFile("tests/fixtures/data.json", undefined)).toBe(true);
  });

  test("a file in a __tests__ directory is a test file", () => {
    expect(build.isTestFile("src/__tests__/x.ts", undefined)).toBe(true);
  });

  test("a file in a nested test directory is a test file", () => {
    expect(build.isTestFile("lib/test/y.ts", undefined)).toBe(true);
  });

  test("a file whose name only contains test as a word fragment is not a test file", () => {
    expect(build.isTestFile("src/latest.ts", undefined)).toBe(false);
  });

  test("a directory whose name only contains test as a fragment is not a test file", () => {
    expect(build.isTestFile("contest/a.ts", undefined)).toBe(false);
  });

  test("a directory named testing is not a test directory", () => {
    expect(build.isTestFile("src/testing/x.ts", undefined)).toBe(false);
  });

  test("a file named test.ts is not a test file", () => {
    expect(build.isTestFile("src/test.ts", undefined)).toBe(false);
  });

  test("a bare path named test is not a test file", () => {
    expect(build.isTestFile("test", undefined)).toBe(false);
  });

  test("a file under a testPaths prefix is a test file", () => {
    expect(build.isTestFile("spec/a.ts", ["spec/"])).toBe(true);
  });

  test("a .test. file outside the testPaths prefixes is not a test file", () => {
    expect(build.isTestFile("src/a.test.ts", ["spec/"])).toBe(false);
  });

  test("a file under a spec directory that is not at the start of its path is not a test file", () => {
    expect(build.isTestFile("src/spec/a.ts", ["spec/"])).toBe(false);
  });

  test("an empty testPaths list makes no file a test file, even a .test. file", () => {
    expect(build.isTestFile("test/a.test.ts", [])).toBe(false);
  });
});

describe("baselineTrees", () => {
  test("a single protected file with no fixes is compared with the start tree", () => {
    expect(build.baselineTrees(["t/a.test.ts"], "S", [])).toEqual([
      { file: "t/a.test.ts", tree: "S" },
    ]);
  });

  test("a file a test fix did not change keeps the start tree, and a changed one takes the fix tree", () => {
    expect(
      build.baselineTrees(["t/a.test.ts", "t/b.test.ts"], "S", [
        { tree: "F1", files: ["t/b.test.ts"] },
      ])
    ).toEqual([
      { file: "t/a.test.ts", tree: "S" },
      { file: "t/b.test.ts", tree: "F1" },
    ]);
  });

  test("a file changed by two test fixes takes the tree of the last fix", () => {
    expect(
      build.baselineTrees(["t/b.test.ts"], "S", [
        { tree: "F1", files: ["t/b.test.ts"] },
        { tree: "F2", files: ["t/b.test.ts"] },
      ])
    ).toEqual([{ file: "t/b.test.ts", tree: "F2" }]);
  });

  test("a fix that changed only other files leaves a protected file on the start tree", () => {
    expect(
      build.baselineTrees(["t/a.test.ts"], "S", [
        { tree: "F1", files: ["t/new.test.ts"] },
      ])
    ).toEqual([{ file: "t/a.test.ts", tree: "S" }]);
  });

  test("no protected files gives no baselines", () => {
    expect(
      build.baselineTrees([], "S", [{ tree: "F1", files: ["t/x.test.ts"] }])
    ).toEqual([]);
  });
});

describe("specTestFiles", () => {
  test("the bullets under the exact heading are listed, backticks optional", () => {
    expect(
      build.specTestFiles(
        "# t\n\n## Test files this task changes\n\n- `test/a.test.ts`\n- test/b.test.ts\n"
      )
    ).toEqual(["test/a.test.ts", "test/b.test.ts"]);
  });

  test("a spec without the heading lists nothing, even when a test path is mentioned in prose", () => {
    expect(
      build.specTestFiles(
        "# t\n\n## Goal\n\nThis task changes test/a.test.ts on purpose.\n"
      )
    ).toEqual([]);
  });

  test("a heading with text after it does not match", () => {
    expect(
      build.specTestFiles("## Test files this task changes (draft)\n\n- test/a.test.ts\n")
    ).toEqual([]);
  });

  test("the heading with no bullets lists nothing", () => {
    expect(build.specTestFiles("## Test files this task changes\n\n")).toEqual([]);
  });

  test("the list ends at the next heading, so a later section's bullets are not listed", () => {
    expect(
      build.specTestFiles(
        "## Test files this task changes\n- `test/a.test.ts`\n\n## Decisions\n\n- test/c.test.ts\n"
      )
    ).toEqual(["test/a.test.ts"]);
  });

  test("a CRLF spec lists its bullets without the carriage return", () => {
    expect(
      build.specTestFiles("## Test files this task changes\r\n- test/a.test.ts\r\n")
    ).toEqual(["test/a.test.ts"]);
  });

  test("only dash bullets are listed, and an empty bullet is dropped", () => {
    expect(
      build.specTestFiles("## Test files this task changes\n\n* test/a.test.ts\n- \n")
    ).toEqual([]);
  });

  test("an empty spec lists nothing", () => {
    expect(build.specTestFiles("")).toEqual([]);
  });
});

describe("editedBaselines", () => {
  test("a baseline whose tree shows its file changed is returned", () => {
    expect(
      build.editedBaselines([{ file: "a", tree: "S" }], new Map([["S", ["a"]]]))
    ).toEqual([{ file: "a", tree: "S" }]);
  });

  test("a baseline whose file did not change in its tree is not returned", () => {
    expect(
      build.editedBaselines(
        [
          { file: "a", tree: "S" },
          { file: "b", tree: "F1" },
        ],
        new Map([
          ["S", ["b"]],
          ["F1", []],
        ])
      )
    ).toEqual([]);
  });

  test("each baseline is compared with its own tree, and both are returned in order", () => {
    expect(
      build.editedBaselines(
        [
          { file: "a", tree: "S" },
          { file: "b", tree: "F1" },
        ],
        new Map([
          ["S", ["a", "b"]],
          ["F1", ["b"]],
        ])
      )
    ).toEqual([
      { file: "a", tree: "S" },
      { file: "b", tree: "F1" },
    ]);
  });

  test("a changed file that is not a baseline is not returned", () => {
    expect(
      build.editedBaselines([{ file: "a", tree: "S" }], new Map([["S", ["src/x.ts"]]]))
    ).toEqual([]);
  });

  test("no baselines gives nothing, whatever the map holds", () => {
    expect(build.editedBaselines([], new Map())).toEqual([]);
  });
});

describe("restoreTestEditsInstructions", () => {
  const CLOSING_PARAGRAPH =
    "Restore each file to its content in the git tree named next to it, for example with `git checkout <tree> -- <file>`; a deleted file is recreated that way. Commit the restore; every commit goes through the repo's hooks. Then make the gate pass without editing any test. When a test seems wrong, ask the PO a question instead of changing it. Change none of these files again: a second change stops the build.";

  test("one edit names its file and tree, and the text covers restore, commit, the PO and no second change", () => {
    const text = build.restoreTestEditsInstructions([
      { file: "test/a.test.ts", tree: "abc123" },
    ]);
    expect(text).toContain("- test/a.test.ts (tree abc123)");
    expect(text).toContain("Restore");
    expect(text).toContain("Commit");
    expect(text).toContain("without editing any test");
    expect(text).toContain("PO");
    expect(text).toContain("again");
  });

  test("two edits each get their own line, in the order given", () => {
    const text = build.restoreTestEditsInstructions([
      { file: "test/a.test.ts", tree: "S" },
      { file: "test/b.test.ts", tree: "F" },
    ]);
    const first = text.indexOf("- test/a.test.ts (tree S)");
    const second = text.indexOf("- test/b.test.ts (tree F)");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });

  test("a file of any kind gets its line, and the closing paragraph stays as written", () => {
    const text = build.restoreTestEditsInstructions([
      { file: "tests/x.json", tree: "S" },
    ]);
    expect(text).toContain("- tests/x.json (tree S)");
    expect(text).toContain(CLOSING_PARAGRAPH);
  });
});

describe("testEditsAgainMessage", () => {
  test("one changed file is named after the restore message", () => {
    expect(build.testEditsAgainMessage(["test/a.test.ts"])).toBe(
      "the test files were changed again after a restore: test/a.test.ts"
    );
  });

  test("two changed files are named in order, separated by a comma", () => {
    expect(build.testEditsAgainMessage(["test/a.test.ts", "test/b.test.ts"])).toBe(
      "the test files were changed again after a restore: test/a.test.ts, test/b.test.ts"
    );
  });

  test("an empty list gives the message with nothing after the colon", () => {
    expect(build.testEditsAgainMessage([])).toBe(
      "the test files were changed again after a restore: "
    );
  });
});
