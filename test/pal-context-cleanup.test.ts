import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { removePalContextFiles } from "../src/targets/lib";
import { freshTestDir } from "./lib/test-home";

function dirWith(files: string[]): string {
  const dir = freshTestDir(import.meta.file);
  for (const f of files) writeFileSync(resolve(dir, f), "x", "utf-8");
  return dir;
}

describe("removePalContextFiles", () => {
  test("removes context files for currently registered slugs", () => {
    const dir = dirWith(["pal-wisdom.instructions.md", "pal-steering.instructions.md"]);
    const removed = removePalContextFiles(dir, ".instructions.md");
    expect(removed.sort()).toEqual([
      "pal-steering.instructions.md",
      "pal-wisdom.instructions.md",
    ]);
    expect(readdirSync(dir)).toEqual([]);
  });

  // Regression: uninstall iterated getSemiStaticSources(), so a slug retired
  // from that registry (e.g. "synthesis") could never be named again — its file
  // survived uninstall and kept feeding retired context into every session.
  test("removes files whose slug is no longer in the source registry", () => {
    const dir = dirWith(["pal-synthesis.instructions.md"]);
    expect(removePalContextFiles(dir, ".instructions.md")).toEqual([
      "pal-synthesis.instructions.md",
    ]);
    expect(existsSync(resolve(dir, "pal-synthesis.instructions.md"))).toBe(false);
  });

  test("removes the legacy pre-split filename without a special case", () => {
    const dir = dirWith(["pal-context.mdc"]);
    expect(removePalContextFiles(dir, ".mdc")).toEqual(["pal-context.mdc"]);
  });

  test("leaves files the user owns alone", () => {
    const dir = dirWith(["my-rules.mdc", "notes.md", "palindrome.mdc"]);
    expect(removePalContextFiles(dir, ".mdc")).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual([
      "my-rules.mdc",
      "notes.md",
      "palindrome.mdc",
    ]);
  });

  test("leaves pal- files with a different suffix alone", () => {
    const dir = dirWith(["pal-wisdom.mdc", "pal-wisdom.instructions.md"]);
    expect(removePalContextFiles(dir, ".mdc")).toEqual(["pal-wisdom.mdc"]);
    expect(readdirSync(dir)).toEqual(["pal-wisdom.instructions.md"]);
  });

  test("is a no-op when the directory does not exist", () => {
    const dir = resolve(freshTestDir(import.meta.file), "never-created");
    expect(removePalContextFiles(dir, ".mdc")).toEqual([]);
  });

  test("ignores subdirectories that happen to match the pattern", () => {
    const dir = freshTestDir(import.meta.file);
    mkdirSync(resolve(dir, "pal-nested.mdc"));
    writeFileSync(resolve(dir, "pal-nested.mdc", "inner.md"), "x", "utf-8");
    expect(removePalContextFiles(dir, ".mdc")).toEqual([]);
    expect(existsSync(resolve(dir, "pal-nested.mdc"))).toBe(true);
  });
});
