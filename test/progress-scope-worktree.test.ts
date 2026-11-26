import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/core/settings";
import { mainCheckoutOf } from "../src/progress/main-checkout";
import { scopeOf } from "../src/progress/progress-tree";
import { freshTestDir } from "./lib/test-home";

let root: string;
let main: string;
let worktree: string;

beforeEach(() => {
  root = freshTestDir(import.meta.file);
  process.env.PAL_HOME = resolve(root, "pal");
  reload();
  main = resolve(root, "git", "shop");
  worktree = resolve(root, "factory", "worktrees", "task-1");
  mkdirSync(resolve(main, ".git", "worktrees", "task-1"), { recursive: true });
  mkdirSync(resolve(worktree, "src"), { recursive: true });
  writeFileSync(
    resolve(worktree, ".git"),
    `gitdir: ${resolve(main, ".git", "worktrees", "task-1")}\n`
  );
});

describe("the scope of a session that works in a linked worktree", () => {
  test("is the main checkout's scope, even when the worktree lives outside the repo", () => {
    expect(scopeOf(worktree)).toBe(scopeOf(main));
  });

  test("a folder inside the worktree maps to the same folder in the main checkout", () => {
    expect(mainCheckoutOf(resolve(worktree, "src"))).toBe(resolve(main, "src"));
  });

  test("the main checkout and a folder with no git stay as they are", () => {
    expect(mainCheckoutOf(main)).toBe(main);
    expect(mainCheckoutOf(resolve(root, "plain"))).toBe(resolve(root, "plain"));
  });
});
