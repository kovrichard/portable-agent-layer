import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { logTokenUsage } from "../src/hooks/lib/token-usage";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-token-usage");

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

describe("logTokenUsage", () => {
  test("writes entry to token-usage.jsonl", () => {
    logTokenUsage("rating", { inputTokens: 100, outputTokens: 50 });

    const logPath = resolve(TEST_HOME, "memory", "signals", "token-usage.jsonl");
    expect(existsSync(logPath)).toBe(true);

    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect(entry.caller).toBe("rating");
    expect(entry.inputTokens).toBe(100);
    expect(entry.outputTokens).toBe(50);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("defaults to HAIKU model when model not specified", () => {
    logTokenUsage("session-name", { inputTokens: 10, outputTokens: 5 });

    const logPath = resolve(TEST_HOME, "memory", "signals", "token-usage.jsonl");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.model).toContain("haiku");
  });

  test("uses provided model when specified", () => {
    logTokenUsage(
      "self-model",
      { inputTokens: 200, outputTokens: 100 },
      "claude-opus-4-7"
    );

    const logPath = resolve(TEST_HOME, "memory", "signals", "token-usage.jsonl");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.model).toBe("claude-opus-4-7");
  });

  test("appends multiple entries", () => {
    const logPath = resolve(TEST_HOME, "memory", "signals", "token-usage.jsonl");
    const before = readFileSync(logPath, "utf-8").trim().split("\n").length;

    logTokenUsage("failure", { inputTokens: 1, outputTokens: 1 });

    const after = readFileSync(logPath, "utf-8").trim().split("\n").length;
    expect(after).toBe(before + 1);
  });
});
