import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { logError, recentHookErrors } from "../src/hooks/lib/log";

const NOW = Date.parse("2026-09-23T12:00:00Z");
let HOME: string;
const savedHome = process.env.PAL_HOME;

function debugLog(name: string, lines: string[]) {
  const dir = resolve(HOME, "debug");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), `${lines.join("\n")}\n`);
}

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-hook-health-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  rmSync(HOME, { recursive: true, force: true });
});

describe("recentHookErrors", () => {
  test("sees an error logError just wrote", () => {
    logError("rating", new Error("boom"));

    expect(recentHookErrors()).toEqual([{ source: "rating", count: 1, last: "boom" }]);
  });

  test("counts only the last 24 hours, read as UTC", () => {
    debugLog("debug.log", [
      "[2026-09-22 11:30:00] ERROR old: outside the window",
      "[2026-09-22 12:30:00] ERROR fresh: inside the window",
    ]);

    expect(recentHookErrors(NOW)).toEqual([
      { source: "fresh", count: 1, last: "inside the window" },
    ]);
  });

  test("groups by the hook that failed, most errors first, each with its newest message", () => {
    debugLog("debug.log.1", [
      "[2026-09-23 09:00:00] ERROR rating: first",
      "[2026-09-23 09:30:00] ERROR agenda: once",
    ]);
    debugLog("debug.log", ["[2026-09-23 11:00:00] ERROR rating: newest"]);

    expect(recentHookErrors(NOW)).toEqual([
      { source: "rating", count: 2, last: "newest" },
      { source: "agenda", count: 1, last: "once" },
    ]);
  });

  test("reports nothing when no log exists", () => {
    expect(recentHookErrors(NOW)).toEqual([]);
  });
});
