import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { turnsSince } from "../src/hooks/lib/interaction";
import { reload } from "../src/hooks/lib/settings";
import { backfillEvents } from "../src/tools/lib/backfill";
import { freshTestDir } from "./lib/test-home";

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  reload();
});

function legacyRow(ts: string, overrides: Record<string, unknown> = {}) {
  return {
    machine: "other-machine",
    actor: "other-actor",
    runtime: "codex",
    authority: "user",
    type: "turn",
    ts,
    session: "s1",
    channel: "discord-mobile",
    hour: 8,
    weekday: "Thu",
    words: 6,
    gapSec: 12.5,
    reply: { words: 120, listItems: 2, headings: 0, asked: true },
    reaction: "follow-up",
    mood: "fast",
    ...overrides,
  };
}

function writeLegacy(...rows: object[]): void {
  const dir = resolve(home, "memory", "signals", "interaction");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "2026-09.jsonl"),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`
  );
}

function streamedTurns(): Record<string, unknown>[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.type === "turn");
}

describe("legacy turn files become turn events", () => {
  test("a row keeps its features and the machine and runtime it was written on", () => {
    writeLegacy(legacyRow("2026-09-10T06:55:09.577Z"));

    expect(backfillEvents()).toMatchObject({ turns: 1 });
    expect(streamedTurns()).toEqual([
      expect.objectContaining({
        id: "turn:s1:2026-09-10T06:55:09.577Z",
        ts: "2026-09-10T06:55:09.577Z",
        session: "s1",
        channel: "discord-mobile",
        machine: "other-machine",
        actor: "other-actor",
        runtime: "codex",
        project: null,
        words: 6,
        gapSec: 12.5,
        reply: { words: 120, listItems: 2, headings: 0, asked: true },
        mood: "fast",
      }),
    ]);
  });

  test("a backfilled turn is read once, not once from each store", () => {
    writeLegacy(
      legacyRow("2026-09-10T06:55:09.577Z"),
      legacyRow("2026-09-10T07:00:00.000Z")
    );
    backfillEvents();

    expect(turnsSince(new Date("2026-09-01")).map((t) => t.ts)).toEqual([
      "2026-09-10T06:55:09.577Z",
      "2026-09-10T07:00:00.000Z",
    ]);
  });

  test("a second run appends nothing, and a row written twice is logged once", () => {
    writeLegacy(
      legacyRow("2026-09-10T06:55:09.577Z"),
      legacyRow("2026-09-10T06:55:09.577Z")
    );
    expect(backfillEvents()).toMatchObject({ turns: 1 });
    expect(backfillEvents()).toMatchObject({ turns: 0 });
  });

  test("--since leaves older turns out", () => {
    writeLegacy(legacyRow("2026-09-10T06:55:09.577Z"));
    expect(backfillEvents("2026-09-11")).toMatchObject({ turns: 0 });
  });
});
