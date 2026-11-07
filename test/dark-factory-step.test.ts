import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import {
  appendEvent,
  readEvents,
  taskDir,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { runStep } from "../assets/plugins/dark-factory/scripts/step.mjs";
import { freshTestDir } from "./lib/test-home";

const TASK = "t1";
const TESTS_COMMAND = "run the tests";
const GATE = [{ name: "tests", run: TESTS_COMMAND }];

type Check = { exitCode: number; output: string };
type Git = Record<string, string | null>;

let root: string;
let env: Record<string, string>;
let worktree: string;
let check: Check;
let git: Git;
let changed: string[];
let checkRuns: string[];

function seedTask(config: object = { baseBranch: "canary", gate: GATE }) {
  writeTask(
    { id: TASK, title: "t", base: "canary", worktree, status: "running", config },
    env
  );
}

function fakeGit(args: string[]) {
  const key = args[0] === "diff" ? `diff ${args.at(-2)} ${args.at(-1)}` : args[0];
  const stdout = key === "ls-tree" ? git[`ls-tree ${args.at(-1)}`] : git[key];
  if (stdout === null || stdout === undefined)
    return { status: 1, stdout: "", stderr: "fatal" };
  return { status: 0, stdout: `${stdout}\n`, stderr: "" };
}

const effects = () => ({
  runCheck: (command: string) => {
    checkRuns.push(command);
    return check;
  },
  spawnTool: (command: string, args: string[]) =>
    command === "git" ? fakeGit(args) : { status: 0, stdout: "", stderr: "" },
  changedFilesSince: () => [...changed],
});

const step = (command: string, id = TASK) =>
  runStep(command, id, { env, effects: effects() });

const events = (name: string) =>
  (readEvents(env) as Record<string, unknown>[]).filter((event) => event.event === name);

const recordBaseline = (failing: number) =>
  appendEvent({ event: "tests_baseline", task: TASK, failing }, env);

beforeEach(() => {
  root = freshTestDir(import.meta.file);
  env = { DARK_FACTORY_HOME: join(root, "factory"), HOME: root };
  worktree = join(root, "worktree");
  mkdirSync(worktree, { recursive: true });
  check = { exitCode: 0, output: " 3 pass" };
  git = { add: "", "write-tree": "tree-now" };
  changed = [];
  checkRuns = [];
  seedTask();
});

describe("step baseline", () => {
  test("a passing run records failing 0, prints it and exits 0", () => {
    expect(step("baseline")).toEqual({ exitCode: 0, result: { failing: 0 } });
    expect(events("tests_baseline")).toEqual([
      expect.objectContaining({ task: TASK, failing: 0 }),
    ]);
    expect(checkRuns).toEqual([TESTS_COMMAND]);
  });

  test("a failing run records its failing count", () => {
    check = { exitCode: 1, output: " 1 pass\n 3 fail" };
    expect(step("baseline")).toEqual({ exitCode: 0, result: { failing: 3 } });
    expect(events("tests_baseline")).toEqual([
      expect.objectContaining({ task: TASK, failing: 3 }),
    ]);
  });

  test("a gate with no tests check records and prints failing 0 without running anything", () => {
    seedTask({ baseBranch: "canary", gate: [{ name: "lint", run: "lint it" }] });
    expect(step("baseline")).toEqual({ exitCode: 0, result: { failing: 0 } });
    expect(events("tests_baseline")).toEqual([
      expect.objectContaining({ task: TASK, failing: 0 }),
    ]);
    expect(checkRuns).toEqual([]);
  });

  test("a failed run without a count prints null and the missing-count message, exit 1", () => {
    check = { exitCode: 1, output: "boom" };
    const { exitCode, result } = step("baseline");
    expect(exitCode).toBe(1);
    expect(result).toEqual({
      failing: null,
      message: expect.stringContaining(
        "the test run failed but reported no failing test count"
      ),
    });
  });
});

describe("step prove-red", () => {
  test("a rise from the baseline is proven, and tests_red records exit code, failing and baseline", () => {
    recordBaseline(3);
    check = { exitCode: 1, output: " 4 fail" };
    expect(step("prove-red")).toEqual({ exitCode: 0, result: { ok: true } });
    expect(events("tests_red")).toEqual([
      expect.objectContaining({
        task: TASK,
        check: "tests",
        exitCode: 1,
        failing: 4,
        baseline: 3,
      }),
    ]);
  });

  test("no rise fails with the no-rise message", () => {
    recordBaseline(3);
    check = { exitCode: 1, output: " 3 fail" };
    const { exitCode, result } = step("prove-red");
    expect(exitCode).toBe(1);
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("did not raise"),
    });
    expect((result as { message: string }).message).toContain(
      "(3 before the typist, 3 after)"
    );
    expect(events("tests_red")).toHaveLength(1);
  });

  test("passing tests fail the proof", () => {
    recordBaseline(3);
    check = { exitCode: 0, output: " 5 pass" };
    const { exitCode, result } = step("prove-red");
    expect(exitCode).toBe(1);
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("the new tests pass before the code exists"),
    });
  });

  test("a failure with no count fails the proof", () => {
    recordBaseline(3);
    check = { exitCode: 1, output: "boom" };
    const { exitCode, result } = step("prove-red");
    expect(exitCode).toBe(1);
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("reported no failing test count"),
    });
  });

  test("with no baseline event any failing count proves red, and baseline is undefined", () => {
    check = { exitCode: 1, output: " 2 fail" };
    expect(step("prove-red")).toEqual({ exitCode: 0, result: { ok: true } });
    const [red] = events("tests_red");
    expect(red).toMatchObject({ failing: 2, exitCode: 1 });
    expect(red?.baseline).toBeUndefined();
  });

  test("it compares with the latest baseline of this task only", () => {
    recordBaseline(9);
    appendEvent({ event: "tests_baseline", task: "other", failing: 50 }, env);
    recordBaseline(1);
    check = { exitCode: 1, output: " 2 fail" };
    expect(step("prove-red").exitCode).toBe(0);
    expect(events("tests_red")[0]).toMatchObject({ baseline: 1 });
  });
});

describe("step snapshot", () => {
  test("records the worktree fingerprint as tree and prints it", () => {
    git["write-tree"] = "abc123";
    expect(step("snapshot")).toEqual({ exitCode: 0, result: { tree: "abc123" } });
    expect(events("tree_snapshot")).toEqual([
      expect.objectContaining({ task: TASK, tree: "abc123" }),
    ]);
  });

  test("an unreadable fingerprint prints FINGERPRINT_UNREADABLE and exits 1", () => {
    git["write-tree"] = null;
    const { exitCode, result } = step("snapshot");
    expect(exitCode).toBe(1);
    expect((result as { message: string }).message).toBe(build.FINGERPRINT_UNREADABLE);
    expect(events("tree_snapshot")).toEqual([]);
  });
});

describe("step test-edits", () => {
  const snapshotAt = (tree: string) =>
    appendEvent({ event: "tree_snapshot", task: TASK, tree }, env);

  test("an edited test file is listed and exits 1", () => {
    snapshotAt("tree-start");
    git["ls-tree tree-start"] = "src/a.ts\ntest/a.test.ts";
    git["diff tree-start tree-now"] = "test/a.test.ts";
    expect(step("test-edits")).toEqual({
      exitCode: 1,
      result: { files: ["test/a.test.ts"] },
    });
  });

  test("a deleted test file is listed", () => {
    snapshotAt("tree-start");
    git["ls-tree tree-start"] = "test/a.test.ts";
    git["diff tree-start tree-now"] = "test/a.test.ts";
    expect(step("test-edits").result).toEqual({ files: ["test/a.test.ts"] });
  });

  test("a new test file and a changed non-test file are not listed, exit 0", () => {
    snapshotAt("tree-start");
    git["ls-tree tree-start"] = "src/a.ts\ntest/a.test.ts";
    git["diff tree-start tree-now"] = "test/new.test.ts\nsrc/a.ts";
    expect(step("test-edits")).toEqual({ exitCode: 0, result: { files: [] } });
  });

  test("it measures from the latest snapshot", () => {
    snapshotAt("tree-old");
    snapshotAt("tree-start");
    git["ls-tree tree-start"] = "test/a.test.ts";
    git["diff tree-start tree-now"] = "";
    expect(step("test-edits")).toEqual({ exitCode: 0, result: { files: [] } });
  });

  test("the repo's testPaths decide what a test file is", () => {
    seedTask({ baseBranch: "canary", gate: GATE, testPaths: ["checks"] });
    snapshotAt("tree-start");
    git["ls-tree tree-start"] = "checks/a.ts\nsrc/b.ts";
    git["diff tree-start tree-now"] = "checks/a.ts\nsrc/b.ts";
    expect(step("test-edits").result).toEqual({ files: ["checks/a.ts"] });
  });

  test("without a snapshot it exits 1 telling to run snapshot first", () => {
    const { exitCode, result } = step("test-edits");
    expect(exitCode).toBe(1);
    expect((result as { message: string }).message).toContain("snapshot");
  });
});

describe("step unplanned", () => {
  test("lists a changed file no document names, and not one plan.md names", () => {
    writeFileSync(join(taskDir(TASK, env), "spec.md"), "# t\n\n## Goal\n\nDo it.\n");
    writeFileSync(join(taskDir(TASK, env), "plan.md"), "Edit `src/planned.ts`.\n");
    changed = ["src/planned.ts", "src/stray.ts"];
    expect(step("unplanned")).toEqual({
      exitCode: 0,
      result: { files: ["src/stray.ts"] },
    });
  });

  test("it records nothing, even when run twice", () => {
    writeFileSync(join(taskDir(TASK, env), "spec.md"), "# t\n");
    changed = ["src/stray.ts"];
    const before = readEvents(env).length;
    step("unplanned");
    step("unplanned");
    expect(readEvents(env)).toHaveLength(before);
  });
});

describe("every command", () => {
  const COMMANDS = ["baseline", "prove-red", "snapshot", "test-edits", "unplanned"];

  test("an unknown task exits 1 with a message naming the task id", () => {
    for (const command of COMMANDS) {
      const { exitCode, result } = step(command, "nope");
      expect(exitCode).toBe(1);
      expect((result as { message: string }).message).toContain("nope");
    }
  });

  test("a missing worktree exits 1 with a message naming the path, for the checks that need it", () => {
    const missing = join(root, "gone");
    writeTask(
      { id: TASK, base: "canary", worktree: missing, config: { gate: GATE } },
      env
    );
    for (const command of ["baseline", "prove-red", "snapshot", "test-edits"]) {
      const { exitCode, result } = runStep(command, TASK, {
        env,
        effects: {
          ...effects(),
          spawnTool: () => ({ status: 128, stdout: "", stderr: "" }),
        },
      });
      expect(exitCode).toBe(1);
      expect((result as { message: string }).message).toContain(missing);
    }
  });
});
