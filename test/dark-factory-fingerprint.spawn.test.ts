import { beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import { spawnTool } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { freshTestDir } from "./lib/test-home";

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

let repo: string;
let env: Record<string, string>;

function git(...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);

  return result.stdout;
}

function fingerprint(): unknown {
  const run = { worktree: repo, env, effects: { spawnTool } };

  return build.worktreeFingerprint(run);
}

function repoState() {
  return {
    status: git("status", "--porcelain"),
    index: readFileSync(join(repo, ".git", "index")).toString("hex"),
  };
}

beforeEach(() => {
  repo = join(freshTestDir(import.meta.file), "repo");
  env = { ...process.env, ...GIT_ENV } as Record<string, string>;
  mkdirSync(repo, { recursive: true });
  git("init", "-q", "-b", "canary");
  writeFileSync(join(repo, "a.test.ts"), "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  writeFileSync(join(repo, "a.test.ts"), "two\n");
});

describe("the worktree fingerprint", () => {
  test("it differs after editing a file that was already modified", () => {
    const before = fingerprint();
    const statusBefore = git("status", "--porcelain");
    writeFileSync(join(repo, "a.test.ts"), "three\n");
    expect(git("status", "--porcelain")).toBe(statusBefore);
    expect(fingerprint()).not.toBe(before);
  });

  test("it differs after a new untracked file appears", () => {
    const before = fingerprint();
    writeFileSync(join(repo, "b.test.ts"), "new\n");
    expect(fingerprint()).not.toBe(before);
  });

  test("it is equal when nothing changed, and when taken twice", () => {
    expect(typeof fingerprint()).toBe("string");
    expect(fingerprint()).toBe(fingerprint());
  });

  test("git status and the index are the same before and after taking it", () => {
    const before = repoState();
    fingerprint();
    fingerprint();
    expect(repoState()).toEqual(before);
  });
});
