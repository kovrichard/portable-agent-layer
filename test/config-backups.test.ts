import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { replaceConfig, replaceJsonConfig } from "../src/targets/lib";
import { freshTestDir } from "./lib/test-home";

let dir: string;
let config: string;

beforeEach(() => {
  dir = freshTestDir(import.meta.file);
  config = join(dir, "settings.json");
});

const backups = () =>
  readdirSync(dir).filter((name) => name.startsWith("settings.json.bak."));

function oldBackups(stamps: number[]): void {
  for (const stamp of stamps) writeFileSync(`${config}.bak.${stamp}`, `${stamp}`);
}

describe("replaceConfig", () => {
  test("a new config is written without a backup", () => {
    replaceConfig(config, "a");
    expect(readFileSync(config, "utf-8")).toBe("a");
    expect(backups()).toEqual([]);
  });

  test("an unchanged config is neither rewritten nor backed up", () => {
    writeFileSync(config, "a");
    replaceConfig(config, "a");
    replaceConfig(config, "a");
    expect(backups()).toEqual([]);
  });

  test("a changed config is backed up once, holding what it replaced", () => {
    writeFileSync(config, "a");
    replaceConfig(config, "b");
    expect(readFileSync(config, "utf-8")).toBe("b");
    expect(backups()).toHaveLength(1);
    expect(readFileSync(join(dir, backups()[0]), "utf-8")).toBe("a");
  });

  test("only the five newest backups are kept, even when nothing changed", () => {
    writeFileSync(config, "a");
    oldBackups([1, 2, 30, 4, 50, 6, 7]);
    replaceConfig(config, "a");
    expect(backups().sort()).toEqual(
      [4, 50, 6, 7, 30].map((stamp) => `settings.json.bak.${stamp}`).sort()
    );
  });

  test("a file that only looks like a backup is left alone", () => {
    writeFileSync(config, "a");
    oldBackups([1, 2, 3, 4, 5, 6]);
    writeFileSync(`${config}.bak.notes`, "mine");
    writeFileSync(join(dir, "other.json.bak.1"), "other");
    replaceConfig(config, "a");
    expect(readdirSync(dir)).toContain("settings.json.bak.notes");
    expect(readdirSync(dir)).toContain("other.json.bak.1");
    expect(backups()).toHaveLength(6);
  });
});

describe("replaceJsonConfig", () => {
  test("writes JSON as writeJson does, so an unchanged object is no change", () => {
    replaceJsonConfig(config, { a: 1 });
    expect(readFileSync(config, "utf-8")).toBe('{\n  "a": 1\n}\n');
    replaceJsonConfig(config, { a: 1 });
    expect(backups()).toEqual([]);
  });
});
