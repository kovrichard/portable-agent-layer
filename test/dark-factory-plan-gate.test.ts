import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import { appendEvent, taskDir } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import {
  buildWorld,
  eventsNamed,
  TASK,
  type World,
} from "./lib/dark-factory-build-fixture";

const STALE_HASH = createHash("sha256").update("an older spec").digest("hex");
const FINDING = { file: "plan.md", problem: "adds a --force flag", fix: "drop the flag" };

type Options = Parameters<typeof buildWorld>[1];

function worldFor(options: Options = {}) {
  return buildWorld(import.meta.file, { category: "feature", ...options });
}

const runBuild = (world: World) =>
  build.runBuild(TASK, { env: world.env, effects: world.effects });

const roleNames = (world: World) => world.roleCalls.map((call) => call.role);
const plannerCalls = (world: World) =>
  world.roleCalls.filter((call) => call.role === "planner");
const reviewerCalls = (world: World) =>
  world.roleCalls.filter((call) => call.role === "reviewer");
const planGateEvents = (world: World) =>
  eventsNamed(world, "plan_gate").map((event) => ({
    round: event.round,
    findings: event.findings,
  }));
const handoverReasonsTo = (world: World, role: string) =>
  eventsNamed(world, "handover")
    .filter((event) => event.to === role)
    .map((event) => event.reason);

function seedStalePlan(world: World, sessionId?: string) {
  writeFileSync(join(taskDir(TASK, world.env), "plan.md"), "old plan");
  appendEvent({ event: "plan_written", task: TASK, specSha256: STALE_HASH }, world.env);
  if (sessionId)
    appendEvent(
      { event: "role_finished", task: TASK, role: "planner", sessionId },
      world.env
    );
}

describe("the plan gate runs after every planner run", () => {
  test("a feature run is test writer, planner, plan gate, unit typist, code writer", () => {
    const world = worldFor();
    expect(runBuild(world).status).toBe("ready");
    expect(roleNames(world).slice(0, 5)).toEqual([
      "test-writer",
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
    ]);
  });

  test("the plan gate's instructions name plan.md and the spec", () => {
    const world = worldFor();
    runBuild(world);
    const instructions = reviewerCalls(world)[0]?.instructions ?? "";
    expect(instructions).toContain("plan.md");
    expect(instructions).toContain("spec");
    expect(handoverReasonsTo(world, "reviewer")[0]).toBe("plan-gate");
  });

  test("a refactor run gates its plan", () => {
    const world = worldFor({ category: "refactor" });
    runBuild(world);
    expect(roleNames(world).slice(0, 3)).toEqual(["planner", "reviewer", "code-writer"]);
  });

  test("a small run has no plan gate", () => {
    const world = worldFor({ category: "small" });
    runBuild(world);
    expect(eventsNamed(world, "plan_gate")).toHaveLength(0);
  });
});

describe("plan gate rounds", () => {
  test("no findings pass in one round with no revision", () => {
    const world = worldFor();
    runBuild(world);
    expect(planGateEvents(world)).toEqual([{ round: 1, findings: 0 }]);
    expect(plannerCalls(world)).toHaveLength(1);
  });

  test("findings resume the planner's session with only those findings", () => {
    const world = worldFor({ roles: { reviewer: [{ reply: { findings: [FINDING] } }] } });
    expect(runBuild(world).status).toBe("ready");
    const calls = plannerCalls(world);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.resumeSessionId).toBe("sess-planner-1");
    expect(calls[1]?.instructions).toContain(FINDING.problem);
    expect(planGateEvents(world)).toEqual([
      { round: 1, findings: 1 },
      { round: 2, findings: 0 },
    ]);
  });

  test("findings in round 2 end waiting with the findings, and no later role runs", () => {
    const finding = { reply: { findings: [FINDING] } };
    const world = worldFor({ roles: { reviewer: [finding, finding] } });
    const result = runBuild(world);
    expect(result.status).toBe("waiting");
    expect(result.message).toContain(FINDING.problem);
    expect(planGateEvents(world)).toEqual([
      { round: 1, findings: 1 },
      { round: 2, findings: 1 },
    ]);
    expect(roleNames(world).filter((role) => role === "test-writer")).toHaveLength(1);
    expect(roleNames(world)).not.toContain("code-writer");
  });

  test("a failing plan-gate reviewer is stuck", () => {
    const world = worldFor({ roles: { reviewer: [{ exit: 1, reply: {} }] } });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("reviewer failed");
    expect(roleNames(world)).toEqual(["test-writer", "planner", "reviewer"]);
  });

  test("a failing revision is stuck as planner failed", () => {
    const world = worldFor({
      roles: {
        reviewer: [{ reply: { findings: [FINDING] } }],
        planner: [{}, { exit: 1 }],
      },
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("planner failed");
  });
});

describe("a re-plan and its plan gate", () => {
  test("a re-plan resumes the planner's latest session", () => {
    const world = worldFor({ commitsAhead: 1 });
    seedStalePlan(world, "sess-old");
    runBuild(world);
    expect(plannerCalls(world)[0]?.resumeSessionId).toBe("sess-old");
    expect(roleNames(world)[1]).toBe("reviewer");
  });

  test("a re-plan whose resume fails runs a fresh planner, then the gate", () => {
    const world = worldFor({ commitsAhead: 1, roles: { planner: [{ exit: 1 }] } });
    seedStalePlan(world, "sess-old");
    runBuild(world);
    const calls = plannerCalls(world);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.resumeSessionId).toBeUndefined();
    expect(calls[1]?.instructions).toContain("spec changed");
    expect(roleNames(world).slice(0, 3)).toEqual(["planner", "planner", "reviewer"]);
  });

  test("a re-plan test writer that leaves changes gets the red proof", () => {
    const world = worldFor({
      commitsAhead: 1,
      roles: { "test-writer": [{ leavesChanges: true }] },
    });
    seedStalePlan(world);
    runBuild(world);
    expect(roleNames(world).slice(0, 5)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "test-writer",
      "code-writer",
    ]);
    expect(eventsNamed(world, "tests_red")).toHaveLength(1);
    const instructions =
      world.roleCalls.find((call) => call.role === "test-writer")?.instructions ?? "";
    expect(instructions).toContain("tests.md");
  });

  test("a re-plan test writer that changes nothing goes straight to the code step", () => {
    const world = worldFor({ commitsAhead: 1 });
    seedStalePlan(world);
    const result = runBuild(world);
    expect(roleNames(world).slice(0, 5)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "test-writer",
      "code-writer",
    ]);
    expect(eventsNamed(world, "tests_red")).toHaveLength(0);
    expect(result.status).toBe("ready");
  });

  test("the re-plan test writer works from spec.md only and the unit typist follows", () => {
    const world = worldFor({ commitsAhead: 1 });
    seedStalePlan(world);
    runBuild(world);
    const writers = world.roleCalls.filter((call) => call.role === "test-writer");
    expect(writers[0]?.instructions ?? "").toContain("spec.md only");
    expect(roleNames(world).slice(0, 4)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "test-writer",
    ]);
    expect(writers[1]?.model).toBe(build.TIER_MODELS.small);
  });
});

describe("an unsettled plan gate on the next build", () => {
  const SPEC_WITHOUT_DECISIONS = "# Add export\n\n## Goal\n\nExport.\n\n";
  const currentHash = createHash("sha256").update(SPEC_WITHOUT_DECISIONS).digest("hex");

  function seedUnsettled(world: World, planHash: string, extra: object[] = []) {
    writeFileSync(join(taskDir(TASK, world.env), "plan.md"), "plan");
    const events = [
      { event: "plan_written", task: TASK, specSha256: planHash },
      { event: "role_finished", task: TASK, role: "planner", sessionId: "sess-old" },
      { event: "plan_gate", task: TASK, round: 2, findings: 1 },
      ...extra,
    ];
    for (const event of events) appendEvent(event, world.env);
  }

  const writersOf = (world: World) =>
    world.roleCalls.filter((call) => call.role === "test-writer");

  test("the planner's latest session resumes with the Decisions, then the gate, then the rest", () => {
    const finding = { reply: { findings: [FINDING] } };
    const world = worldFor({ roles: { reviewer: [finding, finding] } });
    expect(runBuild(world).status).toBe("waiting");
    const firstBuildCalls = world.roleCalls.length;
    runBuild(world);
    const second = world.roleCalls.slice(firstBuildCalls);
    expect(second.map((call) => call.role).slice(0, 4)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
    ]);
    expect(second[0]?.resumeSessionId).toBe("sess-planner-1");
    expect(second[0]?.instructions ?? "").toContain("Decisions");
    expect(second[2]?.model).toBe(build.TIER_MODELS.small);
  });

  test("with commits ahead and a matching spec hash it still settles first", () => {
    const world = worldFor({ commitsAhead: 1 });
    seedUnsettled(world, currentHash);
    runBuild(world);
    expect(roleNames(world).slice(0, 4)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
    ]);
    expect(world.roleCalls[0]?.resumeSessionId).toBe("sess-old");
    expect(plannerCalls(world)[0]?.instructions ?? "").toContain("Decisions");
    expect(writersOf(world)[0]?.model).toBe(build.TIER_MODELS.small);
  });

  test("with a changed spec it settles, gates, then runs the spec-only test writer before the typist", () => {
    const world = worldFor({ commitsAhead: 1 });
    seedUnsettled(world, STALE_HASH);
    runBuild(world);
    expect(roleNames(world).slice(0, 5)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "test-writer",
      "code-writer",
    ]);
    expect(plannerCalls(world)).toHaveLength(1);
    expect(plannerCalls(world)[0]?.instructions ?? "").toContain("Decisions");
    expect(writersOf(world)[0]?.instructions ?? "").toContain("spec.md only");
    expect(writersOf(world)[1]?.model).toBe(build.TIER_MODELS.small);
  });

  test("a settled gate runs no planner", () => {
    const world = worldFor({ commitsAhead: 1 });
    seedUnsettled(world, currentHash, [
      { event: "plan_gate", task: TASK, round: 3, findings: 0 },
    ]);
    runBuild(world);
    expect(plannerCalls(world)).toHaveLength(0);
  });
});

describe("planGateEndedWithFindings", () => {
  const gate = (task: string, round: number, findings: number) => ({
    event: "plan_gate",
    task,
    round,
    findings,
  });
  const rows: [string, object[], boolean][] = [
    ["no events", [], false],
    ["one gate with findings", [gate("t1", 1, 1)], true],
    ["findings then a clean round", [gate("t1", 1, 1), gate("t1", 2, 0)], false],
    ["findings in both rounds", [gate("t1", 1, 2), gate("t1", 2, 2)], true],
    ["another task's findings", [gate("t1", 1, 0), gate("t2", 1, 3)], false],
    [
      "a later non-gate event",
      [gate("t1", 2, 1), { event: "review", task: "t1", round: 1, findings: 0 }],
      true,
    ],
  ];
  for (const [name, events, expected] of rows)
    test(name, () => {
      expect(build.planGateEndedWithFindings(events, "t1")).toBe(expected);
    });
});

describe("the planner prompt", () => {
  test("planner.md asks for signatures, pure/effect, examples, a Criteria map and questions", () => {
    const text = readFileSync(
      join(import.meta.dir, "../assets/plugins/dark-factory/agents/planner.md"),
      "utf8"
    );
    for (const word of [
      "Criteria map",
      "pure",
      "effect",
      "example",
      "signature",
      "question",
    ])
      expect(text).toContain(word);
  });
});
