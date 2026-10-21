import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { guardFile, sharedRepoConfig } from "./lib/repo-config-tripwire";
import { freshTestDir, outsideRepoHome } from "./lib/test-home";

let config: string;

beforeEach(() => {
  config = resolve(freshTestDir(import.meta.file), "config");
  writeFileSync(config, "[core]\n\tbare = false\n");
});

describe("the repository config tripwire", () => {
  test("an untouched file passes", () => {
    expect(guardFile(config)()).toBeNull();
  });

  test("a changed file is named and restored", () => {
    const check = guardFile(config);
    writeFileSync(config, "[user]\n\temail = t@example.com\n");
    expect(check()).toContain(config);
    expect(readFileSync(config, "utf-8")).toBe("[core]\n\tbare = false\n");
  });

  test("finds the config this checkout shares with its worktrees", () => {
    expect(sharedRepoConfig(import.meta.dir)).toMatch(/\.git[\\/]config$/);
  });

  test("outside any checkout there is nothing to guard", () => {
    const outside = outsideRepoHome(import.meta.file);
    mkdirSync(outside, { recursive: true });
    expect(sharedRepoConfig(outside)).toBeNull();
  });
});
