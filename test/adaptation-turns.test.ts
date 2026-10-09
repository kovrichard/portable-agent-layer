import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appendTurn, readTurns, type TurnInput } from "../src/hooks/lib/adaptation-turns";
import { removeOnceReleased } from "./lib/remove-once-released";

let HOME: string;
const savedHome = process.env.PAL_HOME;
const dir = () => resolve(HOME, "memory", "adaptation");

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-turns-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  removeOnceReleased(HOME);
});

const turn: TurnInput = {
  session: "s1",
  message: "that is wrong, the test never ran",
  replyEnd: "All tests pass.",
  reaction: "corrected",
  issue: "claimed tests pass without running them",
  confirmed: true,
};

const at = (iso: string) => new Date(iso);

describe("appendTurn", () => {
  test("a turn reads back with its timestamp", () => {
    appendTurn(turn, at("2026-10-06T10:00:00Z"));

    expect(readTurns(30, at("2026-10-06T11:00:00Z"))).toEqual([
      { ...turn, ts: "2026-10-06T10:00:00.000Z" },
    ]);
  });

  test("turns land in one file per month", () => {
    appendTurn(turn, at("2026-09-30T23:00:00Z"));
    appendTurn(turn, at("2026-10-01T01:00:00Z"));

    expect(readdirSync(dir()).sort()).toEqual([
      "turns-2026-09.jsonl",
      "turns-2026-10.jsonl",
    ]);
  });

  test("long text is cut to what the rater saw", () => {
    appendTurn(
      { ...turn, message: "m".repeat(2000), replyEnd: "r".repeat(2000) },
      at("2026-10-06T10:00:00Z")
    );

    const [read] = readTurns(30, at("2026-10-06T11:00:00Z"));
    expect(read.message).toHaveLength(800);
    expect(read.replyEnd).toHaveLength(600);
  });

  test("a month that ended before the window is deleted", () => {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(resolve(dir(), "turns-2026-07.jsonl"), "");

    appendTurn(turn, at("2026-10-06T10:00:00Z"));

    expect(existsSync(resolve(dir(), "turns-2026-07.jsonl"))).toBe(false);
  });

  test("a month that still overlaps the window is kept", () => {
    appendTurn(turn, at("2026-09-20T10:00:00Z"));

    appendTurn(turn, at("2026-10-06T10:00:00Z"));

    expect(existsSync(resolve(dir(), "turns-2026-09.jsonl"))).toBe(true);
  });
});

describe("readTurns", () => {
  test("no log reads as no turns", () => {
    expect(readTurns()).toEqual([]);
  });

  test("only turns inside the window, oldest first", () => {
    appendTurn({ ...turn, session: "old" }, at("2026-09-01T10:00:00Z"));
    appendTurn({ ...turn, session: "a" }, at("2026-09-20T10:00:00Z"));
    appendTurn({ ...turn, session: "b" }, at("2026-10-06T10:00:00Z"));

    expect(readTurns(30, at("2026-10-06T11:00:00Z")).map((t) => t.session)).toEqual([
      "a",
      "b",
    ]);
  });

  test("a broken line is skipped, not fatal", () => {
    appendTurn(turn, at("2026-10-06T10:00:00Z"));
    appendFileSync(resolve(dir(), "turns-2026-10.jsonl"), "{ broken\n");
    appendTurn({ ...turn, session: "s2" }, at("2026-10-06T10:05:00Z"));

    expect(readTurns(30, at("2026-10-06T11:00:00Z")).map((t) => t.session)).toEqual([
      "s1",
      "s2",
    ]);
  });
});
