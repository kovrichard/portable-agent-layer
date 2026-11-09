import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  readEvents,
  readTask,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { prepare } from "../assets/plugins/dark-factory/scripts/task.mjs";
import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

let home: string;
let clone: string;
let env: Record<string, string>;

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

function put(file: string, content: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

const started = () =>
  readEvents(env).filter(
    (event: { event: string; task?: string }) =>
      event.event === "task_started" && event.task === "t1"
  );

const statusOf = () => (readTask("t1", env) as { status: string }).status;

const setStatus = (status: string) =>
  writeTask({ ...(readTask("t1", env) as object), status }, env);

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  clone = join(home, "clone");
  const userHome = join(home, "user");
  mkdirSync(userHome, { recursive: true });
  env = {
    ...(Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => value !== undefined)
    ) as Record<string, string>),
    ...GIT_ENV,
    HOME: userHome,
    USERPROFILE: userHome,
    DARK_FACTORY_HOME: join(home, "factory"),
  };
  const remote = join(home, "remote.git");
  const seed = join(home, "seed");
  mkdirSync(seed, { recursive: true });
  git(home, "init", "-q", "--bare", "-b", "canary", remote);
  git(seed, "init", "-q", "-b", "canary");
  put(
    join(seed, ".dark-factory.json"),
    JSON.stringify({ gate: [], baseBranch: "canary" })
  );
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "init");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "origin", "canary");
  git(home, "clone", "-q", remote, clone);
  git(clone, "checkout", "-q", "canary");
  put(
    join(env.DARK_FACTORY_HOME as string, "tasks", "t1", "task.json"),
    JSON.stringify({
      id: "t1",
      title: "x",
      repo: clone,
      category: "small",
      status: "draft",
    })
  );
  put(join(env.DARK_FACTORY_HOME as string, "tasks", "t1", "spec.md"), "## Goal\n\nx\n");
});

describe("prepare and a ready task", () => {
  test("a ready task keeps its status, logs no task_started and returns the same fields", () => {
    const first = prepare("t1", env) as Record<string, unknown>;
    setStatus("ready");
    const before = started().length;
    const again = prepare("t1", env) as Record<string, unknown>;
    expect(statusOf()).toBe("ready");
    expect(started()).toHaveLength(before);
    expect(Object.keys(again).sort()).toEqual(Object.keys(first).sort());
    expect(again.po).toBe(first.po);
    expect(again.worktree).toBe(first.worktree);
  });

  test("preparing a ready task twice changes and adds nothing more", () => {
    prepare("t1", env);
    setStatus("ready");
    prepare("t1", env);
    const startedBefore = started().length;
    prepare("t1", env);
    expect(statusOf()).toBe("ready");
    expect(started()).toHaveLength(startedBefore);
  });

  test("a ready task whose worktree was deleted gets it back and stays ready", () => {
    const first = prepare("t1", env) as { worktree: string };
    setStatus("ready");
    git(clone, "worktree", "remove", "--force", first.worktree);
    git(clone, "branch", "-D", "factory/t1");
    removeOnceReleased(first.worktree);
    const again = prepare("t1", env) as { worktree: string };
    expect(existsSync(again.worktree)).toBe(true);
    expect(statusOf()).toBe("ready");
  });
});

describe("prepare on any other status", () => {
  for (const status of ["draft", "waiting", "running", "stuck"]) {
    test(`${status} becomes running and logs one task_started`, () => {
      if (status !== "draft") setStatus(status);
      prepare("t1", env);
      expect(statusOf()).toBe("running");
      expect(started()).toHaveLength(1);
    });
  }
});
