import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { storeDir } from "../src/bronze/bronze";
import { emitRating, ratingsFile } from "../src/bronze/signals";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const TEST_HOME = testHome(import.meta.file);

beforeEach(() => {
  process.env.PAL_HOME = TEST_HOME;
  removeOnceReleased(TEST_HOME);
  mkdirSync(TEST_HOME, { recursive: true });
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

function lastRatingRow(): Record<string, unknown> {
  const lines = readFileSync(ratingsFile(), "utf-8").trim().split("\n");

  return JSON.parse(lines[lines.length - 1]);
}

function lastRatingEvent(): Record<string, unknown> {
  const dir = storeDir("events");
  const events = readdirSync(dir)
    .flatMap((file) => readFileSync(resolve(dir, file), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "rating");

  return events[events.length - 1];
}

describe("emitRating — session", () => {
  test("a rating with a session records it on the row and on the event", () => {
    emitRating(9, "context", "explicit", "preview", "session-1");

    expect(lastRatingRow().session).toBe("session-1");
    expect(lastRatingEvent().session).toBe("session-1");
  });

  test("a rating without a session has no session key on the row and null on the event", () => {
    emitRating(4, "context", "explicit", "preview");

    expect(Object.hasOwn(lastRatingRow(), "session")).toBe(false);
    expect(lastRatingEvent().session).toBeNull();
  });
});

describe("emitSignal — origin stamp", () => {
  test("stamps the emitting machine's id on every signal", () => {
    emitRating(8, "context", "explicit");

    const logPath = resolve(TEST_HOME, "memory", "signals", "ratings.jsonl");
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim());
    const machineFile = JSON.parse(
      readFileSync(resolve(TEST_HOME, "machine.json"), "utf-8")
    );
    expect(entry.machine).toBe(machineFile.id);
  });

  test("stamps the SAME id across multiple signals in one session", () => {
    emitRating(5, "first", "explicit");
    emitRating(6, "second", "explicit");

    const logPath = resolve(TEST_HOME, "memory", "signals", "ratings.jsonl");
    const lines = readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines[0].machine).toBe(lines[1].machine);
    expect(lines[0].machine.length).toBeGreaterThan(0);
  });
});
