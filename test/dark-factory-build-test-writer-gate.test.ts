import { describe, expect, test } from "bun:test";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import {
  buildWorld,
  eventsNamed,
  TASK,
  TESTS_COMMAND,
  type World,
} from "./lib/dark-factory-build-fixture";

const LINT = "lint-cmd";
const CONFIG = {
  baseBranch: "canary",
  gate: [
    { name: "lint", run: LINT, roles: ["test-writer", "code-writer", "debugger"] },
    { name: "tests", run: TESTS_COMMAND },
  ],
};

function worldWithLint(lintResults: number[], config: object = CONFIG) {
  let seen = 0;
  return buildWorld(import.meta.file, {
    category: "feature",
    config,
    checks: {
      [LINT]: () => {
        const exitCode = lintResults[Math.min(seen, lintResults.length - 1)] ?? 0;
        seen += 1;
        return { exitCode, output: exitCode === 0 ? "" : "lint: bad test file" };
      },
    },
  });
}

const runBuild = (world: World) =>
  build.runBuild(TASK, { env: world.env, effects: world.effects });

const testWriterRuns = (world: World) =>
  world.roleCalls.filter((call) => call.role === "test-writer");

const gatesOf = (world: World, role: string) =>
  eventsNamed(world, "gate").filter((event) => event.role === role);

describe("the gate after the test writer", () => {
  test("a passing gate lets the build go on to the red check with one test-writer run", () => {
    const world = worldWithLint([0]);
    expect(runBuild(world).status).toBe("ready");
    expect(gatesOf(world, "test-writer")[0]).toMatchObject({ result: "pass" });
    expect(gatesOf(world, "test-writer").every((event) => event.result === "pass")).toBe(
      true
    );
    expect(testWriterRuns(world).length).toBeGreaterThanOrEqual(1);
    expect(eventsNamed(world, "tests_red").length).toBeGreaterThan(0);
  });

  test("the test writer's gate runs before the red check, and only its listed entries run", () => {
    const world = worldWithLint([0]);
    runBuild(world);
    const firstLint = world.checkCommands.indexOf(LINT);
    const firstTests = world.checkCommands.indexOf(TESTS_COMMAND);
    expect(firstLint).toBeGreaterThanOrEqual(0);
    expect(firstLint).toBeLessThan(firstTests);
  });

  test("a failure once starts the test writer again with the failed checks, then passes", () => {
    const world = worldWithLint([1, 0]);
    expect(runBuild(world).status).toBe("ready");
    const runs = testWriterRuns(world);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[1]?.instructions).toContain("lint");
    expect(runs[1]?.instructions).toContain("lint: bad test file");
    expect(
      gatesOf(world, "test-writer")
        .slice(0, 2)
        .map((event) => event.result)
    ).toEqual(["fail", "pass"]);
    expect(eventsNamed(world, "tests_red").length).toBeGreaterThan(0);
  });

  test("three failures end the run stuck with the failed checks in the message", () => {
    const world = worldWithLint([1]);
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("lint");
    expect(testWriterRuns(world)).toHaveLength(3);
    expect(gatesOf(world, "test-writer")).toHaveLength(3);
    expect(world.roleCalls.some((call) => call.role === "code-writer")).toBe(false);
    expect(eventsNamed(world, "tests_red")).toEqual([]);
    expect(world.pushes).toBe(0);
  });

  test("with no entry listing the test writer nothing runs and the build goes on as today", () => {
    const world = worldWithLint([1], {
      baseBranch: "canary",
      gate: [
        { name: "lint", run: LINT },
        { name: "tests", run: TESTS_COMMAND },
      ],
    });
    const result = runBuild(world);
    expect(gatesOf(world, "test-writer")).toEqual([]);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("gate still fails after 6 attempts");
    expect(testWriterRuns(world).length).toBe(2);
    expect(world.checkCommands.indexOf(LINT)).toBeGreaterThan(
      world.checkCommands.indexOf(TESTS_COMMAND)
    );
    expect(eventsNamed(world, "tests_red").length).toBeGreaterThan(0);
  });

  test("the red check still has to fail", () => {
    const world = buildWorld(import.meta.file, {
      category: "feature",
      config: CONFIG,
      roles: { "test-writer": [{ codes: true }] },
    });
    const result = runBuild(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("the new tests pass before the code exists");
  });
});
