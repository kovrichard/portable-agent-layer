import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { turnsSince } from "../src/hooks/lib/interaction";
import { run } from "../src/tools/agent/interaction";
import { removeOnceReleased } from "./lib/remove-once-released";

let TEST_HOME: string;

function eventsDir(): string {
  return resolve(TEST_HOME, "memory", "signals", "interaction");
}

function writeMonth(file: string, timestamps: string[]) {
  const lines = timestamps.map((ts) => JSON.stringify({ ts, session: "s1", words: 3 }));
  writeFileSync(resolve(eventsDir(), file), `${lines.join("\n")}\n`);
}

async function printed(argv: string[]): Promise<string> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await run(argv);
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
  removeOnceReleased(TEST_HOME);
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
  test("report prints the summary of recent turns", async () => {
    writeMonth(`${new Date().toISOString().slice(0, 7)}.jsonl`, [
      new Date().toISOString(),
    ]);

    expect(await printed(["report", "--days", "2"])).toStartWith(
      "Interaction report, last 2 days\nTurns: 1 in 1 session"
    );
  });

  test("report says so when nothing was measured", async () => {
    expect(await printed(["report"])).toBe("No measured turns in the last 7 days.");
  });

  test.each([
    [[], "Usage: pal cli interaction <command>"],
    [["report", "--help"], "Usage: pal cli interaction report [options]"],
  ])("prints help for %p", async (argv, usage) => {
    expect(await printed(argv)).toContain(usage);
  });

  test("a day count that is not positive fails with the report's usage", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await run(["report", "--days", "0"])).toBe(1);
      expect(error.mock.calls.join("\n")).toContain(
        "error: --days must be a positive number"
      );
    } finally {
      error.mockRestore();
    }
  });
});
