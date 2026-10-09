import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { removeOnceReleased } from "./lib/remove-once-released";
import { runSync } from "./lib/run";
import { freshTestDir, testHome } from "./lib/test-home";

const ROOT = testHome(import.meta.file);
const HOOK = resolve(import.meta.dir, "../.agents/hooks/run-hook.ts");
const MARKER = "gate-ran";

function git(cwd: string, ...args: string[]) {
  runSync(["git", ...args], { cwd });
}

/** A repo whose only commit is one tracked file, so the worktree starts clean. */
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

/** Runs the hook with a command that prints MARKER, so its absence proves a skip. */
function runHookIn(cwd: string) {
  const r = runSync(["bun", "run", HOOK, "echo", MARKER], { cwd });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeAll(() => {
  removeOnceReleased(ROOT);
  mkdirSync(ROOT, { recursive: true });
});

describe("run-hook clean-worktree skip", () => {
  test("skips the gate on a clean worktree and says why", () => {
    const r = runHookIn(makeRepo("clean"));

    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).output).toBe(
      "skipped: worktree clean, HEAD already gated by pre-commit and CI"
    );
  });

  test("runs the gate when a tracked file is modified", () => {
    const dir = makeRepo("modified");
    writeFileSync(resolve(dir, "tracked.txt"), "changed\n");

    const r = runHookIn(dir);

    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).output).toBe("ok");
  });

  test("runs the gate when only an untracked file exists", () => {
    const dir = makeRepo("untracked");
    writeFileSync(resolve(dir, "brand-new.txt"), "new\n");

    const r = runHookIn(dir);

    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).output).toBe("ok");
  });

  // Relies on GIT_CEILING_DIRECTORIES stopping git at .test/: without it
  // `git status` would walk up and succeed against the repo, so the gate would run
  // for the wrong reason and this case would prove nothing.
  test("runs the gate outside a git repository", () => {
    const dir = freshTestDir(import.meta.file);
    try {
      expect(runSync(["git", "status"], { cwd: dir }).status).not.toBe(0);

      const r = runHookIn(dir);

      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).output).toBe("ok");
    } finally {
      removeOnceReleased(dir);
    }
  });

  test("a failing gate still blocks when the worktree is dirty", () => {
    const dir = makeRepo("failing");
    writeFileSync(resolve(dir, "tracked.txt"), "changed\n");

    const r = runSync(["bun", "run", HOOK, "exit", "3"], { cwd: dir });

    expect(r.status).toBe(2);
  });

  test("antigravity runs the gate from the workspace, not from .agents", () => {
    const dir = makeRepo("antigravity-cwd");
    writeFileSync(resolve(dir, "tracked.txt"), "changed\n");
    mkdirSync(resolve(dir, ".agents"));

    const r = runSync(
      ["bun", "run", HOOK, "--antigravity", "test", "-f", "tracked.txt"],
      { cwd: resolve(dir, ".agents") }
    );

    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("antigravity turns a failing gate into a Stop continue", () => {
    const dir = makeRepo("antigravity-failing");
    writeFileSync(resolve(dir, "tracked.txt"), "changed\n");
    mkdirSync(resolve(dir, ".agents"));
    writeFileSync(resolve(dir, "gate.ts"), 'console.log("broken");\nprocess.exit(3);\n');

    const r = runSync(["bun", "run", HOOK, "--antigravity", "bun", "gate.ts"], {
      cwd: resolve(dir, ".agents"),
    });

    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ decision: "continue", reason: "broken" });
  });

  test("a clean worktree skips a gate that would otherwise fail", () => {
    const dir = makeRepo("clean-failing");

    const r = runSync(["bun", "run", HOOK, "exit", "3"], { cwd: dir });

    expect(r.status).toBe(0);
  });
});
