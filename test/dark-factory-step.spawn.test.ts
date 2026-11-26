import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isolationRefusal } from "../.agents/scripts/agent-isolation";
import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { outsideRepoHome, testHome } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const ROOT = testHome(import.meta.file);
const STEP = resolve(import.meta.dir, "../assets/plugins/dark-factory/scripts/step.mjs");
const COMMANDS = ["baseline", "prove-red", "snapshot", "test-edits", "unplanned"];

const editingAgent = {
  tool_name: "Agent",
  tool_input: { subagent_type: "general-purpose" },
};

function git(cwd: string, ...args: string[]) {
  spawnSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(name: string): string {
  const dir = resolve(ROOT, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  writeFileSync(resolve(dir, "tracked.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");

  return dir;
}

function linkedWorktreeOf(main: string, name: string): string {
  const dir = resolve(ROOT, name);
  git(main, "worktree", "add", "-q", "-b", name, dir);

  return dir;
}

function runStepCli(args: string[]) {
  const r = spawnSync("node", [STEP, ...args], {
    encoding: "utf-8",
    env: { ...process.env, DARK_FACTORY_HOME: resolve(ROOT, "factory") },
  });

  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeAll(() => {
  removeOnceReleased(ROOT);
  mkdirSync(ROOT, { recursive: true });
});

describe("step.mjs usage", () => {
  test("no command prints a usage line naming all five commands and exits 2", () => {
    const r = runStepCli([]);
    expect(r.code).toBe(2);

    for (const command of COMMANDS) expect(r.stderr).toContain(command);
    expect(r.stderr).toContain("usage: step.mjs");
  });

  test("an unknown command prints the usage line and exits 2", () => {
    const r = runStepCli(["frobnicate", "t1"]);
    expect(r.code).toBe(2);

    for (const command of COMMANDS) expect(r.stderr).toContain(command);
  });

  test("every command without a task id prints the usage line and exits 2", () => {
    for (const command of COMMANDS) {
      const r = runStepCli([command]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("usage: step.mjs");
    }
  });

  test("an unknown task prints one JSON line naming it and exits 1", () => {
    const r = runStepCli(["snapshot", "no-such-task"]);
    expect(r.code).toBe(1);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(r.stdout).message).toContain("no-such-task");
  });
});

describe("the subagent isolation guard in a git checkout", () => {
  test("in the main checkout an editing agent is still refused with today's message", () => {
    const main = makeRepo("main");
    expect(isolationRefusal(editingAgent, main)).toContain('isolation: "worktree"');
  });

  test("in a linked worktree an editing agent without isolation goes through", () => {
    const main = makeRepo("main-for-link");
    const linked = linkedWorktreeOf(main, "linked");
    expect(isolationRefusal(editingAgent, linked)).toBeNull();
  });

  test("a subdirectory of a linked worktree counts as that worktree", () => {
    const main = makeRepo("main-for-sub");
    const linked = linkedWorktreeOf(main, "linked-sub");
    mkdirSync(resolve(linked, "deep"), { recursive: true });
    expect(isolationRefusal(editingAgent, resolve(linked, "deep"))).toBeNull();
  });

  test("outside any repo git cannot answer, so it refuses", () => {
    const plain = resolve(outsideRepoHome(import.meta.file), "not-a-repo");
    mkdirSync(plain, { recursive: true });
    expect(isolationRefusal(editingAgent, plain)).not.toBeNull();
  });

  test("a missing directory refuses", () => {
    expect(
      isolationRefusal(editingAgent, resolve(ROOT, "does-not-exist"))
    ).not.toBeNull();
  });
});
