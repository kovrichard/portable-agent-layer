import { describe, expect, test } from "bun:test";
import { isLockInput, lockDirs, pathsInPorcelain } from "../.agents/scripts/check-lock";

describe("isLockInput", () => {
  test("accepts every file that decides what bun.lock holds, in any folder", () => {
    for (const path of [
      "package.json",
      "bun.lock",
      "bunfig.toml",
      ".npmrc",
      "a/b/package.json",
    ]) {
      expect(isLockInput(path)).toBe(true);
    }
  });

  test("rejects source files and lookalike names", () => {
    for (const path of [
      "src/index.ts",
      "package.json.bak",
      "bun.lockb",
      "tsconfig.json",
    ]) {
      expect(isLockInput(path)).toBe(false);
    }
  });
});

describe("pathsInPorcelain", () => {
  test("reads modified, untracked and both sides of a rename", () => {
    const porcelain =
      " M package.json\n?? eval/package.json\nR  old/bun.lock -> new/bun.lock\n";
    expect(pathsInPorcelain(porcelain)).toEqual([
      "package.json",
      "eval/package.json",
      "old/bun.lock",
      "new/bun.lock",
    ]);
  });
});

describe("lockDirs", () => {
  test("names the folder of every bun.lock and nothing else", () => {
    expect(
      lockDirs(["bun.lock", "package.json", "a/demo/bun.lock", "a/package.json"])
    ).toEqual([".", "a/demo"]);
  });
});
