import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logTokenUsage } from "../src/hooks/lib/token-usage";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const TEST_HOME = testHome(import.meta.file);

beforeEach(() => {
  process.env.PAL_HOME = TEST_HOME;
  removeOnceReleased(TEST_HOME);
  mkdirSync(TEST_HOME, { recursive: true });
});

const logPath = () => resolve(TEST_HOME, "memory", "signals", "token-usage.jsonl");

function lastEntry() {
  const lines = readFileSync(logPath(), "utf-8").trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

describe("logTokenUsage", () => {
  test("writes entry to token-usage.jsonl", () => {
    logTokenUsage("rating", { usage: { inputTokens: 100, outputTokens: 50 } });

    expect(existsSync(logPath())).toBe(true);
    const entry = lastEntry();
    expect(entry.caller).toBe("rating");
    expect(entry.inputTokens).toBe(100);
    expect(entry.outputTokens).toBe(50);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("a call whose output count is unknown is not summed as zero", () => {
    logTokenUsage("rating", { usage: { inputTokens: 100 } });
    logTokenUsage("rating", { usage: { outputTokens: 100 } });
    logTokenUsage("rating", {});
    expect(existsSync(logPath())).toBe(false);
  });

  test("a call that ran on codex is not labelled as Haiku", () => {
    logTokenUsage("session-name", {
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "gpt-5.5-codex",
    });
    expect(lastEntry().model).toBe("gpt-5.5-codex");
  });

  test("a call whose model is unknown says so", () => {
    logTokenUsage("session-name", { usage: { inputTokens: 10, outputTokens: 5 } });
    expect(lastEntry().model).toBe("unknown");
  });

  test("appends multiple entries", () => {
    logTokenUsage("rating", { usage: { inputTokens: 1, outputTokens: 1 } });
    const before = readFileSync(logPath(), "utf-8").trim().split("\n").length;

    logTokenUsage("failure", { usage: { inputTokens: 1, outputTokens: 1 } });

    const after = readFileSync(logPath(), "utf-8").trim().split("\n").length;
    expect(after).toBe(before + 1);
  });
});
