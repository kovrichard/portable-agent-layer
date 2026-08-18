import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { emitRating } from "../src/hooks/lib/signals";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-signals");

beforeEach(() => {
  process.env.PAL_HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

describe("emitRating", () => {
  test("writes a rating signal to ratings.jsonl", () => {
    emitRating(8, "Good response", "explicit");

    const logPath = resolve(TEST_HOME, "memory", "signals", "ratings.jsonl");
    expect(existsSync(logPath)).toBe(true);

    const line = readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(line);
    expect(entry.type).toBe("rating");
    expect(entry.rating).toBe(8);
    expect(entry.context).toBe("Good response");
    expect(entry.source).toBe("explicit");
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("includes response_preview when provided", () => {
    emitRating(7, "context", "explicit", "preview text");

    const logPath = resolve(TEST_HOME, "memory", "signals", "ratings.jsonl");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.response_preview).toBe("preview text");
  });

  test("omits response_preview when not provided", () => {
    emitRating(5, "no preview", "explicit");

    const logPath = resolve(TEST_HOME, "memory", "signals", "ratings.jsonl");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.response_preview).toBeUndefined();
  });
});
