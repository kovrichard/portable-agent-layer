import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { v8FactoryHome } from "../src/cli/migrations/v8-factory-home";
import { v9ProgressTreeNames } from "../src/cli/migrations/v9-progress-tree-names";
import { homeFile, writeAt } from "./lib/migration-home-fixture";
import { freshTestDir } from "./lib/test-home";

let factory: string;

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
  factory = homeFile("new-factory");
  process.env.DARK_FACTORY_HOME = factory;
});

const EVENT = '{"ts":"2026-01-01T00:00:00.000Z","event":"started"}\n';
const oldFactory = (...segments: string[]) => homeFile("dark-factory", ...segments);
const taskJson = (root: string, id: string) => resolve(root, "tasks", id, "task.json");
const readTask = (id: string) => readFileSync(taskJson(factory, id), "utf-8");

describe("v8-factory-home", () => {
  test("counts every item not already in the new folder", () => {
    mkdirSync(oldFactory("tasks", "t1"), { recursive: true });
    mkdirSync(oldFactory("tasks", "taken"), { recursive: true });
    mkdirSync(resolve(factory, "tasks", "taken"), { recursive: true });

    expect(v8FactoryHome.check()).toEqual({
      pending: true,
      detail: `1 item(s) under ${oldFactory()}`,
    });
  });

  test("is not pending when every item is already moved", () => {
    mkdirSync(oldFactory("tasks", "taken"), { recursive: true });
    mkdirSync(resolve(factory, "tasks", "taken"), { recursive: true });

    expect(v8FactoryHome.check()).toEqual({ pending: false, detail: undefined });
  });

  test.each([
    ["empty", () => ""],
    ["pinned to the old folder", () => oldFactory()],
  ])("with DARK_FACTORY_HOME %s, moves into the user's ~/.dark-factory", (_l, pin) => {
    process.env.DARK_FACTORY_HOME = pin();
    mkdirSync(oldFactory("tasks", "t1"), { recursive: true });
    const userHome = process.env.HOME;
    process.env.HOME = homeFile("user");

    try {
      v8FactoryHome.run();
    } finally {
      process.env.HOME = userHome;
    }

    expect(existsSync(homeFile("user", ".dark-factory", "tasks", "t1"))).toBe(true);
  });

  test("moves tasks, repointing only worktrees under the old folder", () => {
    const oldWorktree = oldFactory("worktrees", "t1");
    writeAt(taskJson(oldFactory(), "t1"), JSON.stringify({ worktree: oldWorktree }));
    const foreign = JSON.stringify({ worktree: "/elsewhere/worktrees/t2" });
    writeAt(taskJson(oldFactory(), "t2"), foreign);
    writeAt(taskJson(oldFactory(), "t3"), JSON.stringify({ worktree: 7 }));
    writeAt(taskJson(oldFactory(), "t4"), "{ not json");
    mkdirSync(oldFactory("tasks", "t5"), { recursive: true });
    mkdirSync(oldFactory("worktrees"), { recursive: true });

    const { migrated, skipped, results } = v8FactoryHome.run();

    expect({ migrated, skipped }).toEqual({ migrated: 5, skipped: 0 });
    expect(results.sort()).toEqual(
      ["t1", "t2", "t3", "t4", "t5"].map((id) => `task/${id}: moved`)
    );
    expect(JSON.parse(readTask("t1")).worktree).toBe(resolve(factory, "worktrees", "t1"));
    expect(readTask("t2")).toBe(foreign);
    expect(readTask("t3")).toBe('{"worktree":7}');
    expect(existsSync(oldFactory())).toBe(false);
  });

  test("a dry run reports every item and leaves even empty folders", () => {
    mkdirSync(oldFactory("tasks", "t1"), { recursive: true });
    mkdirSync(oldFactory("worktrees"), { recursive: true });
    writeAt(oldFactory("events.jsonl"), EVENT);

    expect(v8FactoryHome.run(true)).toEqual({
      migrated: 2,
      skipped: 0,
      results: ["task/t1: would move", "events.jsonl: would append"],
    });
    expect(existsSync(oldFactory("worktrees"))).toBe(true);
    expect(existsSync(oldFactory("events.jsonl"))).toBe(true);
  });

  test("appends events and skips a task already in the new folder", () => {
    mkdirSync(oldFactory("tasks", "taken"), { recursive: true });
    mkdirSync(resolve(factory, "tasks", "taken"), { recursive: true });
    writeAt(oldFactory("events.jsonl"), EVENT);

    expect(v8FactoryHome.run()).toEqual({
      migrated: 1,
      skipped: 1,
      results: [`task/taken: skipped (already in ${factory})`, "events.jsonl: appended"],
    });
    expect(readFileSync(resolve(factory, "events.jsonl"), "utf-8")).toBe(EVENT);
  });

  test("reports events it cannot append as skipped", () => {
    writeAt(oldFactory("events.jsonl"), EVENT);
    mkdirSync(resolve(factory, "events.jsonl"), { recursive: true });

    const { migrated, skipped, results } = v8FactoryHome.run();

    expect({ migrated, skipped }).toEqual({ migrated: 0, skipped: 1 });
    expect(results[0]).toStartWith("events.jsonl: skipped (");
  });
});

const oldTree = (...segments: string[]) => homeFile("memory", "work-tree", ...segments);
const newTree = (...segments: string[]) =>
  homeFile("memory", "progress-tree", ...segments);

describe("v9-progress-tree-names", () => {
  test("run does nothing without the old folder", () => {
    expect(v9ProgressTreeNames.run()).toEqual({ migrated: 0, skipped: 0, results: [] });
  });

  test("appends into a new folder that has no events file yet", () => {
    writeAt(oldTree("events.jsonl"), EVENT);
    mkdirSync(newTree(), { recursive: true });

    expect(v9ProgressTreeNames.run().migrated).toBe(1);
    expect(readFileSync(newTree("events.jsonl"), "utf-8")).toBe(EVENT);
  });

  test("reports a merge it cannot write as skipped", () => {
    writeAt(oldTree("events.jsonl"), EVENT);
    mkdirSync(newTree("events.jsonl"), { recursive: true });

    const { migrated, skipped, results } = v9ProgressTreeNames.run();

    expect({ migrated, skipped }).toEqual({ migrated: 0, skipped: 1 });
    expect(results[0]).toStartWith("memory/work-tree/: skipped (");
  });
});
