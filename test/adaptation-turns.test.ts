import { beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  appendTurn,
  readTurns,
  replaceTurns,
  type Turn,
  type TurnInput,
  turnKey,
} from "../src/opinions/adaptation-turns";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const dir = () => resolve(HOME, "records", "labelled-turns");

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
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

  test("a month that ended before the window stays, since another machine may still send its lines", () => {
    appendTurn(turn, at("2026-07-06T10:00:00Z"));

    appendTurn(turn, at("2026-10-06T10:00:00Z"));

    expect(existsSync(resolve(dir(), "turns-2026-07.jsonl"))).toBe(true);
  });
});

describe("replaceTurns", () => {
  const relabelled = (t: Turn): Turn => ({ ...t, issue: "relabelled" });

  test("appends a revision instead of rewriting, and reading keeps the newest", () => {
    appendTurn(turn, at("2026-10-06T10:00:00Z"));
    const [original] = readTurns(30, at("2026-10-06T11:00:00Z"));
    const file = resolve(dir(), "turns-2026-10.jsonl");
    const before = readFileSync(file, "utf-8");

    replaceTurns(
      new Map([[turnKey(original), relabelled(original)]]),
      at("2026-10-07T00:00:00Z")
    );
    replaceTurns(
      new Map([[turnKey(original), { ...original, issue: "older revision" }]]),
      at("2026-10-06T12:00:00Z")
    );

    expect(readFileSync(file, "utf-8").startsWith(before)).toBe(true);
    expect(readTurns(30, at("2026-10-07T01:00:00Z"))).toEqual([
      { ...relabelled(original), revisedAt: "2026-10-07T00:00:00.000Z" },
    ]);
  });

  test("a revision lands in the month of the turn it revises", () => {
    appendTurn(turn, at("2026-09-30T10:00:00Z"));
    const [original] = readTurns(30, at("2026-10-01T11:00:00Z"));

    replaceTurns(
      new Map([[turnKey(original), relabelled(original)]]),
      at("2026-10-02T00:00:00Z")
    );

    expect(readdirSync(dir())).toEqual(["turns-2026-09.jsonl"]);
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

  test("lines another machine appended later read in time order", () => {
    appendTurn({ ...turn, session: "here" }, at("2026-10-06T10:05:00Z"));
    appendTurn({ ...turn, session: "there" }, at("2026-10-06T10:00:00Z"));

    expect(readTurns(30, at("2026-10-06T11:00:00Z")).map((t) => t.session)).toEqual([
      "there",
      "here",
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
