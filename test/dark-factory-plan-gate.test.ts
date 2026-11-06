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
  test("a feature run is planner, plan gate, test writer, code writer", () => {
    const world = worldFor();
    expect(runBuild(world).status).toBe("ready");
    expect(roleNames(world).slice(0, 4)).toEqual([
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
    expect(roleNames(world)).not.toContain("test-writer");
    expect(roleNames(world)).not.toContain("code-writer");
  });

  test("a failing plan-gate reviewer is stuck", () => {
    const world = worldFor({ roles: { reviewer: [{ exit: 1, reply: {} }] } });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("reviewer failed");
    expect(roleNames(world)).toEqual(["planner", "reviewer"]);
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
    expect(roleNames(world).slice(0, 4)).toEqual([
      "planner",
      "reviewer",
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
    expect(roleNames(world).slice(0, 4)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
    ]);
    expect(eventsNamed(world, "tests_red")).toHaveLength(0);
    expect(result.status).toBe("ready");
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
