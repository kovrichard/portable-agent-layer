import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { emptyResult } from "../src/sync/context";
import {
  markFinished,
  markRunning,
  noticeFor,
  quarantineCount,
  readSyncStatus,
  syncStatusFile,
} from "../src/sync/status";
import { freshTestDir } from "./lib/test-home";

const HOUR = 60 * 60_000;
const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const ok = { result: emptyResult() };
const refusing = { result: { ...emptyResult(), refused: ["a: tampered", "b: missing"] } };

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
});

function quarantine(...files: string[]) {
  for (const file of files) {
    const path = resolve(home, "backups", "sync-quarantine", file);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, "x");
  }
}

describe("the notice", () => {
  test("a clean run has none", () => {
    expect(noticeFor(ok, 0, undefined, NOW)).toBeNull();
  });

  test("files in quarantine are counted and point to the status command", () => {
    expect(noticeFor(ok, 2, undefined, NOW)).toBe(
      "2 file(s) in quarantine (pal cli sync status)"
    );
  });

  test("refused files are counted", () => {
    expect(noticeFor(refusing, 0, undefined, NOW)).toBe("2 refused (pal cli sync)");
  });

  test("a failed run within a day of the last success is a blip and stays silent", () => {
    const recent = new Date(NOW - 23 * HOUR).toISOString();

    expect(noticeFor({ error: "fetch failed" }, 0, recent, NOW)).toBeNull();
  });

  test("a failed run a day after the last success, or with none, shows the error", () => {
    const old = new Date(NOW - 25 * HOUR).toISOString();

    expect(noticeFor({ error: "fetch failed" }, 0, old, NOW)).toBe(
      "failing: fetch failed (pal cli sync)"
    );
    expect(noticeFor({ error: "fetch failed" }, 0, undefined, NOW)).toBe(
      "failing: fetch failed (pal cli sync)"
    );
  });

  test("a long error is cut to eighty characters", () => {
    expect(noticeFor({ error: "e".repeat(200) }, 0, undefined, NOW)).toBe(
      `failing: ${"e".repeat(80)} (pal cli sync)`
    );
  });

  test("a blip still shows the quarantine", () => {
    const recent = new Date(NOW - HOUR).toISOString();

    expect(noticeFor({ error: "x" }, 1, recent, NOW)).toBe(
      "1 file(s) in quarantine (pal cli sync status)"
    );
  });
});

describe("the status file", () => {
  test("is empty and idle before any run", () => {
    expect(readSyncStatus(home)).toEqual({ running: false, notice: null });
  });

  test("an unreadable file reads as idle", () => {
    mkdirSync(resolve(home, "cache"), { recursive: true });
    writeFileSync(syncStatusFile(home), "{not json");

    expect(readSyncStatus(home)).toEqual({ running: false, notice: null });
  });

  test("a run marks itself running with its start in epoch seconds", () => {
    markRunning(home, NOW + 999);

    expect(readSyncStatus(home)).toEqual({
      running: true,
      startedAt: NOW / 1000,
      notice: null,
    });
  });

  test("a successful run records its time and clears the notice", () => {
    markRunning(home, NOW);
    markFinished(home, NOW, refusing);
    markFinished(home, NOW + HOUR, ok);

    expect(readSyncStatus(home)).toEqual({
      running: false,
      lastSuccessAt: new Date(NOW + HOUR).toISOString(),
      notice: null,
    });
  });

  test("a failed run keeps the last success and judges the error against it", () => {
    markFinished(home, NOW, ok);
    markFinished(home, NOW + 25 * HOUR, { error: "boom" });

    expect(readSyncStatus(home)).toEqual({
      running: false,
      lastSuccessAt: new Date(NOW).toISOString(),
      notice: "failing: boom (pal cli sync)",
    });
  });

  test("a finished run counts the quarantine folder, nested files included", () => {
    quarantine("a.md", "memory/b.json");
    markFinished(home, NOW, ok);

    expect(quarantineCount(home)).toBe(2);
    expect(readSyncStatus(home).notice).toBe(
      "2 file(s) in quarantine (pal cli sync status)"
    );
  });
});
