import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logError, recentHookErrors } from "../src/hooks/lib/log";
import { freshTestDir } from "./lib/test-home";

const NOW = Date.parse("2026-09-23T12:00:00Z");
let HOME: string;

function debugLog(name: string, lines: string[]) {
  const dir = resolve(HOME, "debug");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), `${lines.join("\n")}\n`);
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
});

describe("recentHookErrors", () => {
  test("sees an error logError just wrote", () => {
    logError("rating", new Error("boom"));

    expect(recentHookErrors()).toMatchObject([
      { source: "rating", count: 1, last: "boom" },
    ]);
  });

  test("counts only the last 24 hours, read as UTC", () => {
    debugLog("debug.log", [
      "[2026-09-22 11:30:00] ERROR old: outside the window",
      "[2026-09-22 12:30:00] ERROR fresh: inside the window",
    ]);

    expect(recentHookErrors(NOW)).toMatchObject([
      { source: "fresh", count: 1, last: "inside the window" },
    ]);
  });

  test("groups by the hook that failed, most errors first, each with its newest message and when", () => {
    debugLog("debug.log.1", [
      "[2026-09-23 09:00:00] ERROR rating: first",
      "[2026-09-23 09:30:00] ERROR agenda: once",
    ]);
    debugLog("debug.log", ["[2026-09-23 11:00:00] ERROR rating: newest"]);

    expect(recentHookErrors(NOW)).toEqual([
      {
        source: "rating",
        count: 2,
        last: "newest",
        lastAt: Date.parse("2026-09-23T11:00:00Z"),
        lastMessage: "newest",
      },
      {
        source: "agenda",
        count: 1,
        last: "once",
        lastAt: Date.parse("2026-09-23T09:30:00Z"),
        lastMessage: "once",
      },
    ]);
  });

  test("a failed agent call reports what the agent said, not its argv", () => {
    debugLog("debug.log", [
      '[2026-09-23 11:00:00] ERROR inference:spawn: caller=agenda exited=1 binary=claude argv=["--print","--model","m"] stderr(0)= stdout(14)=Login expired.',
    ]);

    expect(recentHookErrors(NOW)[0].last).toBe("Login expired.");
  });

  test("a debug line that merely mentions '] ERROR ' is not an error", () => {
    debugLog("debug.log", [
      `[2026-09-23 11:00:00] DEBUG SecurityValidator: bashVerdict=ALLOW command=grep "] ERROR rating: boom" debug.log`,
      "[2026-09-23 11:30:00] ERROR rating: boom",
    ]);

    expect(recentHookErrors(NOW)).toMatchObject([{ source: "rating", count: 1 }]);
  });

  test("the newest error keeps its whole message, tags included", () => {
    debugLog("debug.log", [
      "[2026-09-23 11:00:00] ERROR inference:spawn: caller=agenda auth=token exited=1 binary=claude stderr(5)=boom stdout(0)=",
    ]);

    expect(recentHookErrors(NOW)[0].lastMessage).toContain("auth=token");
  });

  test("a failed agent call prefers its stderr when it wrote one", () => {
    debugLog("debug.log", [
      '[2026-09-23 11:00:00] ERROR inference:spawn: caller=agenda exited=1 binary=claude argv=["--print"] stderr(9)=rate limit stdout(4)=noise',
    ]);

    expect(recentHookErrors(NOW)[0].last).toBe("rate limit");
  });

  test("reports nothing when no log exists", () => {
    expect(recentHookErrors(NOW)).toEqual([]);
  });
});
