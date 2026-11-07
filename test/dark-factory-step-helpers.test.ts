import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  latestTaskEvent,
  stepRun,
} from "../assets/plugins/dark-factory/scripts/step.mjs";

const SAMPLE_EFFECTS = { runCheck: () => ({ exitCode: 0, output: "" }) };

describe("latestTaskEvent", () => {
  test("returns the last event of the named task and name, skipping other tasks", () => {
    const events = [
      { event: "tests_baseline", task: "t1", failing: 9 },
      { event: "tests_baseline", task: "other", failing: 50 },
      { event: "tests_baseline", task: "t1", failing: 1 },
    ];
    expect(latestTaskEvent(events, "t1", "tests_baseline")).toEqual({
      event: "tests_baseline",
      task: "t1",
      failing: 1,
    });
  });

  test("returns undefined when only another task has the event", () => {
    const events = [{ event: "tree_snapshot", task: "t2", tree: "a" }];
    expect(latestTaskEvent(events, "t1", "tree_snapshot")).toBeUndefined();
  });

  test("returns undefined when there are no events", () => {
    expect(latestTaskEvent([], "t1", "tests_baseline")).toBeUndefined();
  });

  test("returns the snapshot even when a later event has another name", () => {
    const events = [
      { event: "tree_snapshot", task: "t1", tree: "a" },
      { event: "tests_baseline", task: "t1", failing: 2 },
    ];
    expect(latestTaskEvent(events, "t1", "tree_snapshot")).toEqual({
      event: "tree_snapshot",
      task: "t1",
      tree: "a",
    });
  });
});

describe("stepRun", () => {
  test("builds the run from a task with a worktree, base and gate", () => {
    const env = { DARK_FACTORY_HOME: "/f" };
    expect(
      stepRun(
        { worktree: "/w", base: "canary", config: { gate: [] } },
        "t1",
        env,
        SAMPLE_EFFECTS
      )
    ).toEqual({
      id: "t1",
      env,
      effects: SAMPLE_EFFECTS,
      worktree: "/w",
      base: "canary",
      config: { gate: [] },
      taskDir: join("/f", "tasks", "t1"),
      testFixTrees: [],
    });
  });

  test("keeps the test paths of the config and the base of the task", () => {
    const env = { DARK_FACTORY_HOME: "/f" };
    expect(
      stepRun(
        { worktree: "/x", base: "main", config: { gate: [], testPaths: ["checks"] } },
        "t2",
        env,
        SAMPLE_EFFECTS
      )
    ).toEqual({
      id: "t2",
      env,
      effects: SAMPLE_EFFECTS,
      worktree: "/x",
      base: "main",
      config: { gate: [], testPaths: ["checks"] },
      taskDir: join("/f", "tasks", "t2"),
      testFixTrees: [],
    });
  });

  test("a task with no fields gives undefined worktree, base and config", () => {
    const env = { DARK_FACTORY_HOME: "/f" };
    expect(stepRun({}, "t3", env, SAMPLE_EFFECTS)).toEqual({
      id: "t3",
      env,
      effects: SAMPLE_EFFECTS,
      worktree: undefined,
      base: undefined,
      config: undefined,
      taskDir: join("/f", "tasks", "t3"),
      testFixTrees: [],
    });
  });
});
