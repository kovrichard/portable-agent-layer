import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sweepStaleHandoffs } from "../src/hooks/lib/stop";
import { linkFile } from "./lib/links";
import { freshTestDir } from "./lib/test-home";

const NOW_SECONDS = 1_800_000_000;
const NOW_MS = NOW_SECONDS * 1000;
const DAY_SECONDS = 24 * 60 * 60;

let home: string;

function handoffDir(): string {
  return resolve(home, "memory", "state", "transcript-handoff");
}

function handoffFile(name: string, ageSeconds: number): string {
  const file = resolve(handoffDir(), name);
  mkdirSync(handoffDir(), { recursive: true });
  writeFileSync(file, "transcript", "utf-8");
  const mtime = NOW_SECONDS - ageSeconds;
  utimesSync(file, mtime, mtime);

  return file;
}

function loggedErrors(): string[] {
  const log = resolve(home, "debug", "debug.log");
  if (!existsSync(log)) return [];

  return readFileSync(log, "utf-8")
    .split("\n")
    .filter((line) => line.includes("ERROR "));
}

describe("sweepStaleHandoffs", () => {
  beforeEach(() => {
    home = freshTestDir(import.meta.file);
    process.env.PAL_HOME = home;
    mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  });

  test("keeps a file exactly 24 h old and removes one a second older", () => {
    const boundary = handoffFile("boundary.txt", DAY_SECONDS);
    const stale = handoffFile("stale.txt", DAY_SECONDS + 1);

    sweepStaleHandoffs(NOW_MS);

    expect(existsSync(boundary)).toBe(true);
    expect(existsSync(stale)).toBe(false);
    expect(loggedErrors()).toEqual([]);
  });

  test("logs a file it cannot remove and still removes the others", () => {
    const blocker = resolve(handoffDir(), "blocker");
    mkdirSync(blocker, { recursive: true });
    utimesSync(blocker, NOW_SECONDS - 2 * DAY_SECONDS, NOW_SECONDS - 2 * DAY_SECONDS);
    const stale = handoffFile("stale.txt", 2 * DAY_SECONDS);

    sweepStaleHandoffs(NOW_MS);

    expect(existsSync(stale)).toBe(false);
    const errors = loggedErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ERROR sweepStaleHandoffs: ");
  });

  test.skipIf(process.platform === "win32")(
    "skips a file that is gone by the time it is read, without logging",
    () => {
      const stale = handoffFile("stale.txt", 2 * DAY_SECONDS);
      linkFile(
        resolve(handoffDir(), "missing.txt"),
        resolve(handoffDir(), "vanished.txt")
      );

      sweepStaleHandoffs(NOW_MS);

      expect(existsSync(stale)).toBe(false);
      expect(loggedErrors()).toEqual([]);
    }
  );

  test("logs under its own name when the hand-off folder is a file", () => {
    writeFileSync(handoffDir(), "not a folder", "utf-8");

    expect(() => sweepStaleHandoffs(NOW_MS)).not.toThrow();

    const errors = loggedErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ERROR sweepStaleHandoffs: ");
  });
});
