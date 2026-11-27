import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { v19RulesToLog } from "../src/cli/migrations/v19-rules-to-log";
import { readRules } from "../src/opinions/adaptation-rules";
import { legacyRulesPath, ruleLogPath } from "../src/opinions/rule-log";
import { freshTestDir } from "./lib/test-home";

const rule = (id: string, status: string) => ({
  id,
  status,
  when: "w",
  steering: "s",
  evidence: [],
  createdAt: "2026-10-01T00:00:00.000Z",
});

function homeInRecordsLayout(name = import.meta.file): string {
  const home = freshTestDir(name);
  mkdirSync(resolve(home, "records"), { recursive: true });
  process.env.PAL_HOME = home;

  return home;
}

beforeEach(() => {
  homeInRecordsLayout();
});

function legacy(rules: unknown[]): void {
  mkdirSync(dirname(legacyRulesPath()), { recursive: true });
  writeFileSync(legacyRulesPath(), JSON.stringify(rules, null, 2));
}

describe("v19-rules-to-log", () => {
  test("moves every rule into the log and removes rules.json", () => {
    legacy([rule("a", "approved"), rule("b", "draft")]);
    const before = readRules();

    expect(v19RulesToLog.check()).toEqual({
      pending: true,
      detail: "2 rule(s) in rules.json",
    });
    expect(v19RulesToLog.run()).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["moved 2 rule(s) to the log (2 new line(s))"],
    });
    expect(existsSync(legacyRulesPath())).toBe(false);
    expect(readRules()).toEqual(before);
    expect(v19RulesToLog.check().pending).toBe(false);
  });

  test("a dry run changes nothing", () => {
    legacy([rule("a", "approved")]);

    expect(v19RulesToLog.run(true).results).toEqual(["would move 1 rule(s) to the log"]);
    expect(existsSync(legacyRulesPath())).toBe(true);
    expect(existsSync(ruleLogPath())).toBe(false);
  });

  test("two machines with the same rules write the same lines", () => {
    legacy([rule("a", "approved")]);
    v19RulesToLog.run();
    const here = readFileSync(ruleLogPath(), "utf-8");
    homeInRecordsLayout(`${import.meta.file}-other`);
    legacy([rule("a", "approved")]);
    v19RulesToLog.run();

    expect(readFileSync(ruleLogPath(), "utf-8")).toBe(here);
  });

  test("waits while the home has not moved its stores into records/, reading rules.json meanwhile", () => {
    process.env.PAL_HOME = freshTestDir(`${import.meta.file}-unmoved`);
    legacy([rule("a", "approved")]);

    expect(v19RulesToLog.check().pending).toBe(false);
    expect(v19RulesToLog.run()).toEqual({ migrated: 0, skipped: 0, results: [] });
    expect(existsSync(resolve(process.env.PAL_HOME, "records"))).toBe(false);
    expect(readRules().map((r) => r.id)).toEqual(["a"]);
  });

  test("nothing to move is no work", () => {
    expect(v19RulesToLog.check()).toEqual({ pending: false, detail: undefined });
    expect(v19RulesToLog.run()).toEqual({ migrated: 0, skipped: 0, results: [] });
  });
});
