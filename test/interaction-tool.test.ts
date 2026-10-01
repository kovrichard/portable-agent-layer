import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { turnsSince } from "../src/hooks/lib/interaction";
import { run } from "../src/tools/agent/interaction";

let TEST_HOME: string;

function eventsDir(): string {
  return resolve(TEST_HOME, "memory", "signals", "interaction");
}

function writeMonth(file: string, timestamps: string[]) {
  const lines = timestamps.map((ts) => JSON.stringify({ ts, session: "s1", words: 3 }));
  writeFileSync(resolve(eventsDir(), file), `${lines.join("\n")}\n`);
}

function printed(argv: string[]): string {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    run(argv);
    return log.mock.calls.map((c) => c.join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
}

beforeEach(() => {
  TEST_HOME = mkdtempSync(resolve(tmpdir(), "pal-interaction-tool-"));
  process.env.PAL_HOME = TEST_HOME;
  mkdirSync(eventsDir(), { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("reading turns back", () => {
  test("returns only turns since the date, across month files, in order", () => {
    writeMonth("2026-08.jsonl", ["2026-08-30T10:00:00.000Z"]);
    writeMonth("2026-09.jsonl", ["2026-09-10T10:00:00.000Z", "2026-09-20T10:00:00.000Z"]);
    writeMonth("2026-10.jsonl", ["2026-10-01T10:00:00.000Z"]);
    writeFileSync(resolve(eventsDir(), "notes.txt"), "not events");

    expect(turnsSince(new Date("2026-09-15T00:00:00Z")).map((e) => e.ts)).toEqual([
      "2026-09-20T10:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
    ]);
  });
});

describe("pal cli interaction", () => {
  test("report prints the summary of recent turns", () => {
    writeMonth(`${new Date().toISOString().slice(0, 7)}.jsonl`, [
      new Date().toISOString(),
    ]);

    expect(printed(["report", "--days", "2"])).toStartWith(
      "Interaction report, last 2 days\nTurns: 1 in 1 session"
    );
  });

  test("report says so when nothing was measured", () => {
    expect(printed(["report"])).toBe("No measured turns in the last 7 days.");
  });

  test.each([
    [[]],
    [["report", "--days", "0"]],
    [["report", "--help"]],
  ])("prints help without a report verb or a valid day count: %p", (argv) => {
    expect(printed(argv)).toContain("Usage: pal cli interaction report [--days N]");
  });
});
