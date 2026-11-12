import { describe, expect, test } from "bun:test";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import {
  buildWorld,
  eventsNamed,
  type RoleStep,
  TASK,
  type World,
} from "./lib/dark-factory-build-fixture";

const NOOP: RoleStep = { codes: false };
const FINDING = { file: "plan.md", problem: "narrows a criterion", fix: "widen it" };

function worldFor(options: Parameters<typeof buildWorld>[1] = {}) {
  return buildWorld(import.meta.file, options);
}

function runBuild(world: World) {
  return build.runBuild(TASK, { env: world.env, effects: world.effects });
}

const progress = (world: World) =>
  eventsNamed(world, "role_run").map((event) => [event.role, event.step, event.planned]);

describe("step and planned on every role_run", () => {
  test("a straight big-feature run counts 1/8 through 8/8", () => {
    const world = worldFor({ category: "big-feature" });
    expect(runBuild(world).status).toBe("ready");
    expect(progress(world)).toEqual([
      ["architect", 1, 8],
      ["test-writer", 2, 8],
      ["planner", 3, 8],
      ["reviewer", 4, 8],
      ["test-writer", 5, 8],
      ["code-writer", 6, 8],
      ["reviewer", 7, 8],
      ["tester", 8, 8],
    ]);
  });

  test("a plan-gate retry grows planned by one per repeated role", () => {
    const world = worldFor({
      category: "feature",
      roles: {
        reviewer: [{ reply: { findings: [FINDING] } }, { reply: { findings: [] } }],
      },
    });
    expect(runBuild(world).status).toBe("ready");
    expect(progress(world)).toEqual([
      ["test-writer", 1, 7],
      ["planner", 2, 7],
      ["reviewer", 3, 7],
      ["planner", 4, 8],
      ["reviewer", 5, 9],
      ["test-writer", 6, 9],
      ["code-writer", 7, 9],
      ["reviewer", 8, 9],
      ["tester", 9, 9],
    ]);
  });

  test("the code ladder up to the debugger grows planned with each attempt", () => {
    const world = worldFor({ roles: { "code-writer": [NOOP, NOOP, NOOP, NOOP] } });
    expect(runBuild(world).status).toBe("ready");
    expect(progress(world)).toEqual([
      ["code-writer", 1, 2],
      ["code-writer", 2, 3],
      ["code-writer", 3, 4],
      ["code-writer", 4, 5],
      ["debugger", 5, 6],
      ["reviewer", 6, 6],
    ]);
  });

  test("a PO answer is not counted as a step", () => {
    const question = { done: false, summary: "", question: "which file?" };
    const world = worldFor({ roles: { "code-writer": [{ reply: question }] } });
    expect(runBuild(world).status).toBe("ready");
    expect(world.roleCalls.map((call) => call.role)).toContain("po");
    expect(progress(world)).toEqual([
      ["code-writer", 1, 2],
      ["reviewer", 2, 2],
    ]);
  });
});
