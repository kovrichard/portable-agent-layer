import { describe, expect, test } from "bun:test";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import {
  buildWorld,
  eventsNamed,
  type RoleStep,
  TASK,
  TESTS_COMMAND,
  type World,
} from "./lib/dark-factory-build-fixture";

type Run = { exitCode: number; output: string };
const failRun = (count: number): Run => ({
  exitCode: 1,
  output: ` 1 pass\n ${count} fail`,
});
const acceptance = failRun(2);
const TYPIST_FILES = ["test/a.test.ts", "test/b.test.ts"];

type Setup = {
  runs: Run[];
  typist?: RoleStep[];
  diff?: string[] | null;
  dropSessionId?: boolean;
};

function scenario(setup: Setup) {
  const typist = setup.typist ?? [{ leavesChanges: true }, {}];
  const world = buildWorld(import.meta.file, {
    category: "feature",
    roles: { "test-writer": [{}, ...typist] },
    checks: {
      [TESTS_COMMAND]: (w: World): Run =>
        setup.runs[w.checkCommands.length - 1] ?? { exitCode: 0, output: " 3 pass" },
    },
  });
  const effects = world.effects as Record<string, (...args: never[]) => unknown>;
  const realSpawn = effects.spawnTool as (c: string, a: string[]) => unknown;
  effects.spawnTool = ((command: string, args: string[]) => {
    if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
      if (setup.diff === null) return { status: 128, stdout: "", stderr: "fatal" };
      return {
        status: 0,
        stdout: `${(setup.diff ?? TYPIST_FILES).join("\n")}\n`,
        stderr: "",
      };
    }
    return realSpawn(command, args);
  }) as never;
  if (setup.dropSessionId) {
    const realRole = effects.runRoleHeadless as (...a: unknown[]) => object;
    let testWriterRuns = 0;
    effects.runRoleHeadless = ((taskId: string, role: string, args: object) => {
      const outcome = realRole(taskId, role, args);
      if (role === "test-writer" && ++testWriterRuns === 2)
        return { ...outcome, sessionId: null };
      return outcome;
    }) as never;
  }
  return world;
}

const run = (world: World) =>
  build.runBuild(TASK, { env: world.env, effects: world.effects });
const typistRuns = (world: World) =>
  world.roleCalls.filter((call) => call.role === "test-writer").slice(1);
const roles = (world: World) => world.roleCalls.map((call) => call.role);

describe("a unit typist that does not raise the failing count goes back once", () => {
  test("baseline 3 and after 3 records unit_tests_no_rise with the counts and changed files", () => {
    const world = scenario({ runs: [acceptance, failRun(3), failRun(3), failRun(4)] });
    run(world);
    const events = eventsNamed(world, "unit_tests_no_rise");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        task: TASK,
        baseline: 3,
        failing: 3,
        files: TYPIST_FILES,
      })
    );
  });

  test("a lower count (7 before, 5 after) is a no-rise too", () => {
    const world = scenario({ runs: [acceptance, failRun(7), failRun(5), failRun(8)] });
    run(world);
    expect(eventsNamed(world, "unit_tests_no_rise")[0]).toEqual(
      expect.objectContaining({ baseline: 7, failing: 5 })
    );
    expect(typistRuns(world)).toHaveLength(2);
  });

  test("the retry runs the test writer again before any code writer", () => {
    const world = scenario({ runs: [acceptance, failRun(3), failRun(3), failRun(4)] });
    run(world);
    expect(typistRuns(world)).toHaveLength(2);
    expect(roles(world).lastIndexOf("test-writer")).toBeLessThan(
      roles(world).indexOf("code-writer")
    );
  });

  test("the retry's instructions name both counts, each file and the move-to-a-new-file rule", () => {
    const world = scenario({ runs: [acceptance, failRun(3), failRun(3), failRun(4)] });
    run(world);
    const instructions = typistRuns(world)[1]?.instructions ?? "";
    expect(instructions).toMatch(/\b3\b/);
    for (const file of TYPIST_FILES) expect(instructions).toContain(file);
    expect(instructions).toMatch(/fails? to load/i);
    expect(instructions).toMatch(/one failure/i);
    expect(instructions).toContain("however many tests it holds");
    expect(instructions).toContain("new test file");
    expect(instructions).toContain("no other test uses");
    expect(instructions).toContain("uncommitted");
    expect(instructions).toContain("change no other file");
  });

  test("the retry's instructions name two different counts when they differ", () => {
    const world = scenario({ runs: [acceptance, failRun(7), failRun(5), failRun(8)] });
    run(world);
    const instructions = typistRuns(world)[1]?.instructions ?? "";
    expect(instructions).toMatch(/\b7\b/);
    expect(instructions).toMatch(/\b5\b/);
  });

  test("the retry resumes the typist's session when the first run returned one", () => {
    const world = scenario({ runs: [acceptance, failRun(3), failRun(3), failRun(4)] });
    run(world);
    const [first, second] = typistRuns(world);
    expect(first?.resumeSessionId).toBeUndefined();
    expect(second?.resumeSessionId).toBe("sess-test-writer-2");
  });

  test("without a session id the retry is a fresh test-writer run with the same instructions", () => {
    const world = scenario({
      runs: [acceptance, failRun(3), failRun(3), failRun(4)],
      dropSessionId: true,
    });
    run(world);
    const calls = typistRuns(world);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.resumeSessionId ?? undefined).toBeUndefined();
    expect(calls[1]?.instructions).toContain("test/a.test.ts");
    expect(calls[1]?.instructions).toMatch(/\b3\b/);
  });

  test("a rise after the retry is ready, with one unit_tests_done and the baseline in tests_red", () => {
    const world = scenario({ runs: [acceptance, failRun(3), failRun(3), failRun(4)] });
    const result = run(world);
    expect(result.status).toBe("ready");
    expect(eventsNamed(world, "unit_tests_done")).toHaveLength(1);
    expect(eventsNamed(world, "tests_red").at(-1)).toEqual(
      expect.objectContaining({ baseline: 3, failing: 4 })
    );
    expect(roles(world)).toContain("code-writer");
  });

  test("no rise after the retry is stuck with both counts and no code writer, after exactly two typist runs", () => {
    const world = scenario({ runs: [acceptance, failRun(3), failRun(3), failRun(3)] });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("3 before the typist, 3 after");
    expect(roles(world)).not.toContain("code-writer");
    expect(typistRuns(world)).toHaveLength(2);
    expect(eventsNamed(world, "unit_tests_no_rise")).toHaveLength(1);
    expect(eventsNamed(world, "unit_tests_done")).toHaveLength(0);
  });

  test("a retry that changes nothing still gets the proof against the first baseline", () => {
    const world = scenario({
      runs: [acceptance, failRun(3), failRun(3), failRun(4)],
      typist: [{ leavesChanges: true }, {}],
    });
    const result = run(world);
    expect(result.status).toBe("ready");
    expect(eventsNamed(world, "tests_red")).toHaveLength(3);
    expect(eventsNamed(world, "tests_red").at(-1)).toEqual(
      expect.objectContaining({ baseline: 3, failing: 4 })
    );
  });

  test("a retry that changes nothing and does not rise is stuck", () => {
    const world = scenario({ runs: [acceptance, failRun(3), failRun(3), failRun(3)] });
    expect(run(world).status).toBe("stuck");
    expect(world.checkCommands).toHaveLength(4);
  });

  test("a git diff that fails gives files null and instructions that say the files could not be listed", () => {
    const world = scenario({
      runs: [acceptance, failRun(3), failRun(3), failRun(4)],
      diff: null,
    });
    const result = run(world);
    expect(eventsNamed(world, "unit_tests_no_rise")[0]?.files).toBeNull();
    expect(typistRuns(world)).toHaveLength(2);
    expect(typistRuns(world)[1]?.instructions).toMatch(/could not be listed/i);
    expect(result.status).toBe("ready");
  });

  test("a question from the typist during the retry goes the question route", () => {
    const world = scenario({
      runs: [acceptance, failRun(3), failRun(3)],
      typist: [
        { leavesChanges: true },
        { reply: { done: false, summary: "", question: "which file?" } },
      ],
    });
    const result = run(world);
    expect(result.status).not.toBe("ready");
    expect(roles(world)).toContain("po");
  });
});

describe("the other red-proof stops get no retry", () => {
  test("tests that pass after the typist are stuck with today's message and one typist run", () => {
    const world = scenario({
      runs: [acceptance, failRun(3), { exitCode: 0, output: " 5 pass" }],
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("the new tests pass before the code exists");
    expect(typistRuns(world)).toHaveLength(1);
    expect(eventsNamed(world, "unit_tests_no_rise")).toHaveLength(0);
  });

  test("output with no count after the typist is stuck with the missing-count message and one typist run", () => {
    const world = scenario({
      runs: [acceptance, failRun(3), { exitCode: 1, output: "segfault" }],
    });
    const result = run(world);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("reported no failing test count");
    expect(typistRuns(world)).toHaveLength(1);
    expect(eventsNamed(world, "unit_tests_no_rise")).toHaveLength(0);
  });

  test("a typist that changed nothing gets no proof and no retry", () => {
    const world = scenario({
      runs: [acceptance, failRun(3), failRun(3)],
      typist: [{}],
    });
    const result = run(world);
    expect(result.status).toBe("ready");
    expect(typistRuns(world)).toHaveLength(1);
    expect(eventsNamed(world, "unit_tests_no_rise")).toHaveLength(0);
  });

  test("a rise at the first proof sends nothing back", () => {
    const world = scenario({ runs: [acceptance, failRun(3), failRun(4)] });
    expect(run(world).status).toBe("ready");
    expect(typistRuns(world)).toHaveLength(1);
    expect(eventsNamed(world, "unit_tests_no_rise")).toHaveLength(0);
  });
});
