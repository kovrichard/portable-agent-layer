import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import { appendEvent, taskDir } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { appendDecision } from "../assets/plugins/dark-factory/scripts/task.mjs";
import {
  buildWorld,
  eventsNamed,
  TASK,
  type World,
} from "./lib/dark-factory-build-fixture";

const SPEC_WITHOUT_DECISIONS = "# Add export\n\n## Goal\n\nExport.\n\n";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const SPEC_HASH = sha256(SPEC_WITHOUT_DECISIONS);
const STALE_HASH = sha256("an older spec");
const QUESTION = { done: false, summary: "", question: "which file?" };

type Options = Parameters<typeof buildWorld>[1];

function worldFor(options: Options = {}) {
  return buildWorld(import.meta.file, { category: "feature", ...options });
}

const runBuild = (world: World) =>
  build.runBuild(TASK, { env: world.env, effects: world.effects });

const roleNames = (world: World) => world.roleCalls.map((call) => call.role);
const planPath = (world: World) => join(taskDir(TASK, world.env), "plan.md");
const specPath = (world: World) => join(taskDir(TASK, world.env), "spec.md");

function recordPlanWritten(world: World, specSha256: string) {
  appendEvent({ event: "plan_written", task: TASK, specSha256 }, world.env);
}

function commitsAhead(world: World) {
  world.effects.spawnTool = () => ({ status: 0, stdout: "1" });
}

function setTimes(path: string, seconds: number) {
  utimesSync(path, seconds, seconds);
}

const plannerCalls = (world: World) =>
  world.roleCalls.filter((call) => call.role === "planner");

const handoverReasonsTo = (world: World, role: string) =>
  eventsNamed(world, "handover")
    .filter((event) => event.to === role)
    .map((event) => event.reason);

describe("plan_written records the spec the planner saw", () => {
  test("a first run with a planner appends plan_written with the spec hash minus Decisions", () => {
    const world = worldFor();
    runBuild(world);
    expect(eventsNamed(world, "plan_written")).toEqual([
      expect.objectContaining({ task: TASK, specSha256: SPEC_HASH }),
    ]);
  });

  test("a category without a planner records no plan_written", () => {
    const world = worldFor({ category: "small" });
    runBuild(world);
    expect(eventsNamed(world, "plan_written")).toHaveLength(0);
  });

  test("a decision appended after the plan does not count as a spec change", () => {
    const world = worldFor();
    runBuild(world);
    appendDecision(
      TASK,
      { role: "planner", question: "which file?", answer: "a.ts" },
      world.env
    );
    commitsAhead(world);
    world.roleCalls.length = 0;
    runBuild(world);
    expect(plannerCalls(world)).toHaveLength(0);
  });

  test("a planner that fails records no plan_written", () => {
    const world = worldFor({ roles: { planner: [{ exit: 1 }] } });
    expect(runBuild(world).status).toBe("stuck");
    expect(eventsNamed(world, "plan_written")).toHaveLength(0);
  });
});

describe("a rerun after the spec changed", () => {
  test("commits ahead and a different recorded hash: the planner runs before the code writer", () => {
    const world = worldFor();
    writeFileSync(planPath(world), "old plan");
    recordPlanWritten(world, STALE_HASH);
    commitsAhead(world);
    expect(runBuild(world).status).toBe("ready");
    expect(roleNames(world).slice(0, 5)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "test-writer",
      "code-writer",
    ]);
    expect(plannerCalls(world)).toHaveLength(1);
    const instructions = plannerCalls(world)[0]?.instructions ?? "";
    expect(instructions).toContain("spec changed");
    expect(instructions).toContain("plan.md");
    expect(instructions).toContain("commits");
  });

  test("tests already proved red also trigger the re-plan", () => {
    const world = worldFor();
    writeFileSync(planPath(world), "old plan");
    recordPlanWritten(world, STALE_HASH);
    appendEvent({ event: "tests_red", task: TASK, exitCode: 1, failing: 2 }, world.env);
    runBuild(world);
    expect(roleNames(world).slice(0, 5)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "test-writer",
      "code-writer",
    ]);
  });

  test("tests proved red but no plan yet: the first plan is written with the plan-after-tests instructions", () => {
    const world = worldFor();
    appendEvent({ event: "tests_red", task: TASK, exitCode: 1, failing: 2 }, world.env);
    runBuild(world);
    expect(roleNames(world).slice(0, 4)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
    ]);
    expect(handoverReasonsTo(world, "planner")).toEqual(["pipeline"]);
    expect(plannerCalls(world)[0]?.instructions ?? "").not.toContain("spec changed");
  });

  test("a matching hash runs no planner", () => {
    const world = worldFor();
    writeFileSync(planPath(world), "plan");
    recordPlanWritten(world, SPEC_HASH);
    commitsAhead(world);
    runBuild(world);
    expect(plannerCalls(world)).toHaveLength(0);
  });

  test("the latest plan_written event counts", () => {
    const world = worldFor();
    writeFileSync(planPath(world), "plan");
    recordPlanWritten(world, STALE_HASH);
    recordPlanWritten(world, SPEC_HASH);
    commitsAhead(world);
    runBuild(world);
    expect(plannerCalls(world)).toHaveLength(0);
  });

  test("a missing plan.md on a rerun runs the planner", () => {
    const world = worldFor();
    recordPlanWritten(world, SPEC_HASH);
    commitsAhead(world);
    runBuild(world);
    expect(roleNames(world).slice(0, 2)).toEqual(["planner", "reviewer"]);
  });

  test("a category without a planner never re-plans", () => {
    const world = worldFor({ category: "small" });
    recordPlanWritten(world, STALE_HASH);
    commitsAhead(world);
    runBuild(world);
    expect(roleNames(world)).not.toContain("planner");
  });

  test("a first run is test writer, planner, plan gate, unit typist, code writer, with no spec-changed handover", () => {
    const world = worldFor();
    runBuild(world);
    expect(roleNames(world).slice(0, 5)).toEqual([
      "test-writer",
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
    ]);
    expect(handoverReasonsTo(world, "planner")).toEqual(["pipeline"]);
  });
});

describe("a task planned before plan_written existed", () => {
  test("spec.md newer than plan.md re-plans", () => {
    const world = worldFor();
    writeFileSync(planPath(world), "plan");
    setTimes(planPath(world), 1_000_000);
    setTimes(specPath(world), 2_000_000);
    commitsAhead(world);
    runBuild(world);
    expect(roleNames(world).slice(0, 2)).toEqual(["planner", "reviewer"]);
  });

  test("spec.md older than plan.md does not re-plan", () => {
    const world = worldFor();
    writeFileSync(planPath(world), "plan");
    setTimes(specPath(world), 1_000_000);
    setTimes(planPath(world), 2_000_000);
    commitsAhead(world);
    runBuild(world);
    expect(plannerCalls(world)).toHaveLength(0);
  });
});

describe("how a re-plan is recorded and stopped", () => {
  test("it is a handover with reason spec-changed and writes a new plan_written", () => {
    const world = worldFor();
    writeFileSync(planPath(world), "old plan");
    recordPlanWritten(world, STALE_HASH);
    commitsAhead(world);
    runBuild(world);
    expect(handoverReasonsTo(world, "planner")).toEqual(["spec-changed"]);
    expect(eventsNamed(world, "plan_written").map((event) => event.specSha256)).toEqual([
      STALE_HASH,
      SPEC_HASH,
    ]);
  });

  test("a re-plan question the PO sends to the user is waiting", () => {
    const world = worldFor({
      roles: {
        planner: [{ reply: QUESTION }],
        po: [{ reply: { userQuestion: "Which database?" } }],
      },
    });
    writeFileSync(planPath(world), "old plan");
    recordPlanWritten(world, STALE_HASH);
    commitsAhead(world);
    expect(runBuild(world)).toMatchObject({ status: "waiting" });
    expect(roleNames(world)).not.toContain("code-writer");
  });

  test("a failed re-plan is stuck", () => {
    const world = worldFor({ roles: { planner: [{ exit: 1 }] } });
    writeFileSync(planPath(world), "old plan");
    recordPlanWritten(world, STALE_HASH);
    commitsAhead(world);
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("planner failed");
    expect(roleNames(world)).not.toContain("code-writer");
  });
});

describe("a re-plan and a resumed build", () => {
  function cleanWorktreeAt(world: World, head: string) {
    const answers: Record<string, string> = {
      "rev-list": "1",
      "rev-parse": head,
      status: "",
    };
    world.effects.spawnTool = (_command: string, args: string[]) => ({
      status: 0,
      stdout: answers[args[0]] ?? "",
    });
  }

  test("a re-plan codes the new plan even when the code step finished at this commit", () => {
    const world = worldFor();
    writeFileSync(planPath(world), "old plan");
    recordPlanWritten(world, STALE_HASH);
    appendEvent({ event: "step_done", task: TASK, step: "code", head: "abc" }, world.env);
    cleanWorktreeAt(world, "abc");
    runBuild(world);
    expect(roleNames(world).slice(0, 5)).toEqual([
      "planner",
      "reviewer",
      "test-writer",
      "test-writer",
      "code-writer",
    ]);
  });

  test("without a spec change the finished code step is still skipped", () => {
    const world = worldFor();
    writeFileSync(planPath(world), "plan");
    recordPlanWritten(world, SPEC_HASH);
    appendEvent({ event: "step_done", task: TASK, step: "code", head: "abc" }, world.env);
    cleanWorktreeAt(world, "abc");
    runBuild(world);
    expect(roleNames(world)).not.toContain("code-writer");
  });
});
