import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../.test-tmp/run-hook-skip");
const HOOK = resolve(import.meta.dir, "../.agents/hooks/run-hook.ts");
const MARKER = "gate-ran";

function git(cwd: string, ...args: string[]) {
  spawnSync("git", args, { cwd, stdio: "ignore" });
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
  const r = spawnSync("bun", ["run", HOOK, "echo", MARKER], {
    cwd,
    encoding: "utf-8",
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
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

  // Must live outside the repo tree: a directory nested inside it would make
  // `git status` walk up and succeed against the parent, so the gate would run
  // for the wrong reason and this case would prove nothing.
  test("runs the gate outside a git repository", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "pal-run-hook-"));
    try {
      expect(spawnSync("git", ["status"], { cwd: dir }).status).not.toBe(0);

      const r = runHookIn(dir);

      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).output).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("a failing gate still blocks when the worktree is dirty", () => {
    const dir = makeRepo("failing");
    writeFileSync(resolve(dir, "tracked.txt"), "changed\n");

    const r = spawnSync("bun", ["run", HOOK, "exit", "3"], {
      cwd: dir,
      encoding: "utf-8",
    });

    expect(r.status).toBe(2);
  });

  test("a clean worktree skips a gate that would otherwise fail", () => {
    const dir = makeRepo("clean-failing");

    const r = spawnSync("bun", ["run", HOOK, "exit", "3"], {
      cwd: dir,
      encoding: "utf-8",
    });

    expect(r.status).toBe(0);
  });
});
