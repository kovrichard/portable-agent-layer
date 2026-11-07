import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import { appendEvent, taskDir } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import {
  buildWorld,
  eventsNamed,
  TASK,
  TESTS_COMMAND,
  type World,
} from "./lib/dark-factory-build-fixture";

const STALE_HASH = "0".repeat(64);
const SETTLE_FINDINGS = 2;

type Run = { exitCode: number; output: string };
type Options = Parameters<typeof buildWorld>[1];
type Spawn = (command: string, args: string[]) => unknown;
type Headless = (taskId: string, role: string, args: object) => unknown;

const failRun = (count: number, pad = ""): Run => ({
  exitCode: 1,
  output: `${pad} 1 pass\n ${count} fail`,
});

function sequenced(runs: Run[]) {
  return {
    [TESTS_COMMAND]: (world: World): Run =>
      runs[world.checkCommands.length - 1] ?? { exitCode: 0, output: " 3 pass" },
  };
}

function replanWorld(runs: Run[], options: Options = {}) {
  const world = buildWorld(import.meta.file, {
    category: "feature",
    commitsAhead: 1,
    ...options,
    checks: sequenced(runs),
  });
  const dir = taskDir(TASK, world.env);
  writeFileSync(join(dir, "plan.md"), "old plan");
  appendEvent({ event: "plan_written", task: TASK, specSha256: STALE_HASH }, world.env);
  return world;
}

function settleWorld(runs: Run[], options: Options = {}) {
  const world = replanWorld(runs, options);
  appendEvent(
    { event: "plan_gate", task: TASK, round: 2, findings: SETTLE_FINDINGS },
    world.env
  );
  return world;
}

const runBuild = (world: World) =>
  build.runBuild(TASK, { env: world.env, effects: world.effects });

const testWriterCalls = (world: World) =>
  world.roleCalls.filter((call) => call.role === "test-writer");

function checksWhenRoleStarts(world: World, wanted: string, nth: number) {
  const original = world.effects.runRoleHeadless as Headless;
  const seen: number[] = [];
  let count = 0;
  world.effects.runRoleHeadless = (taskId: string, role: string, args: object) => {
    if (role === wanted && ++count === nth) seen.push(world.checkCommands.length);
    return original(taskId, role, args);
  };
  return seen;
}

function unreadableFingerprint(world: World) {
  const original = world.effects.spawnTool as Spawn;
  world.effects.spawnTool = (command: string, args: string[]) =>
    args[0] === "add" || args[0] === "write-tree"
      ? { status: 128, stdout: "", stderr: "fatal" }
      : original(command, args);
}

const noRiseHead = (baseline: number, failing: number) =>
  `the unit tests did not raise the failing test count (${baseline} before the typist, ${failing} after), so they prove nothing; a test file that fails to load counts as one failure, however many tests it holds:`;

const SCENARIOS = [
  { name: "a replan", make: replanWorld },
  { name: "a plan settled after the gate", make: settleWorld },
] as const;

for (const { name, make } of SCENARIOS) {
  describe(`tests written after ${name} must raise the failing count`, () => {
    const afterWriter = { "test-writer": [{ leavesChanges: true }, {}] };

    test("the tests check runs once before the test writer starts", () => {
      const world = make([failRun(3), failRun(4), failRun(4)], { roles: afterWriter });
      const seen = checksWhenRoleStarts(world, "test-writer", 1);
      runBuild(world);
      expect(seen).toEqual([1]);
      expect(world.checkCommands[0]).toBe(TESTS_COMMAND);
    });

    test("a test file that is already modified and modified again gets the proof", () => {
      const world = make([failRun(3), failRun(3)], {
        roles: { "test-writer": [{ editsModifiedFile: true }, {}] },
      });
      world.uncommitted = true;
      const result = runBuild(world);
      expect(result.status).toBe("stuck");
      expect(result.message).toContain(noRiseHead(3, 3));
      expect(eventsNamed(world, "tests_red")).toHaveLength(1);
    });

    test("baseline 3 and after 3 is stuck, naming both counts and the output tail", () => {
      const world = make([failRun(3), failRun(3, "AFTERRUN")], { roles: afterWriter });
      const result = runBuild(world);
      expect(result.status).toBe("stuck");
      expect(result.message).toBe(`${noRiseHead(3, 3)}\nAFTERRUN 1 pass\n 3 fail`);
      expect(world.roleCalls.map((call) => call.role)).not.toContain("code-writer");
    });

    test("a lower count after the test writer is stuck too", () => {
      const world = make([failRun(7), failRun(5)], { roles: afterWriter });
      const result = runBuild(world);
      expect(result.status).toBe("stuck");
      expect(result.message).toContain(noRiseHead(7, 5));
    });

    test("a rise goes on to the code writer and tests_red carries the baseline", () => {
      const world = make([failRun(3), failRun(4), failRun(4)], { roles: afterWriter });
      const result = runBuild(world);
      expect(result.status).toBe("ready");
      expect(eventsNamed(world, "tests_red")[0]).toEqual(
        expect.objectContaining({ task: TASK, exitCode: 1, failing: 4, baseline: 3 })
      );
      expect(world.roleCalls.map((call) => call.role)).toContain("code-writer");
    });

    test("a baseline of 0 lets any failing test prove the rise", () => {
      const world = make([{ exitCode: 0, output: " 5 pass" }, failRun(1), failRun(1)], {
        roles: afterWriter,
      });
      expect(runBuild(world).status).toBe("ready");
      expect(eventsNamed(world, "tests_red")[0]).toEqual(
        expect.objectContaining({ baseline: 0, failing: 1 })
      );
    });

    test("a test writer that changed nothing gets no proof and the build goes on", () => {
      const world = make([failRun(3), failRun(3), failRun(3)], {
        roles: { "test-writer": [{}, {}] },
      });
      const seen = checksWhenRoleStarts(world, "code-writer", 1);
      const result = runBuild(world);
      expect(result.status).toBe("ready");
      expect(eventsNamed(world, "tests_red")).toHaveLength(0);
      expect(seen).toEqual([2]);
    });

    test("a baseline with no failing count stops stuck before the test writer runs", () => {
      const world = make([{ exitCode: 1, output: "segfault, no summary" }]);
      const result = runBuild(world);
      expect(result.status).toBe("stuck");
      expect(result.message).toContain("reported no failing test count");
      expect(testWriterCalls(world)).toHaveLength(0);
    });

    test("an unreadable fingerprint counts as changed, so the proof runs", () => {
      const world = make([failRun(3), failRun(4), failRun(4), failRun(5)], {
        roles: { "test-writer": [{}, {}] },
      });
      unreadableFingerprint(world);
      const result = runBuild(world);
      expect(result.status).toBe("ready");
      expect(eventsNamed(world, "tests_red")).toEqual([
        expect.objectContaining({ baseline: 3, failing: 4 }),
        expect.objectContaining({ baseline: 4, failing: 5 }),
      ]);
    });
  });
}
