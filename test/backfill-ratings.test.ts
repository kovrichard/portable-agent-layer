import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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

function ratingRow(ts: string, overrides: Record<string, unknown> = {}) {
  return {
    ts,
    machine: "other-machine",
    actor: "other-actor",
    runtime: "codex",
    authority: "user",
    type: "rating",
    rating: 3,
    context: "a private rated context",
    source: "implicit",
    response_preview: "a private reply preview",
    ...overrides,
  };
}

function writeRatings(...rows: object[]): void {
  const dir = resolve(home, "memory", "signals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ratings.jsonl"),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`
  );
}

function logLines(dir: string): Record<string, unknown>[] {
  const path = resolve(home, dir, "events");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const ratings = () => logLines("memory").filter((e) => e.type === "rating");

describe("rating signals become rating events", () => {
  test("a rating keeps its score, source and origin; its text goes to content", () => {
    writeRatings(ratingRow("2026-09-10T06:55:09.577Z"));

    expect(backfillEvents()).toMatchObject({ ratings: 1 });
    expect(ratings()).toEqual([
      expect.objectContaining({
        id: "rating:other-machine:2026-09-10T06:55:09.577Z",
        ts: "2026-09-10T06:55:09.577Z",
        machine: "other-machine",
        runtime: "codex",
        rating: 3,
        source: "implicit",
      }),
    ]);
    expect(JSON.stringify(logLines("memory"))).not.toContain("private");
    expect(logLines("memory/content")).toEqual([
      expect.objectContaining({
        context: "a private rated context",
        responsePreview: "a private reply preview",
      }),
    ]);
  });

  test("a rating from before attribution existed is logged as unknown origin", () => {
    writeRatings(
      ratingRow("2026-08-01T10:00:00.000Z", {
        machine: undefined,
        actor: undefined,
        runtime: undefined,
        authority: undefined,
      })
    );
    backfillEvents();
    expect(ratings()).toEqual([
      expect.objectContaining({
        id: "rating:unknown:2026-08-01T10:00:00.000Z",
        machine: "unknown",
      }),
    ]);
  });

  test("a second run appends nothing", () => {
    writeRatings(
      ratingRow("2026-09-10T06:55:09.577Z"),
      ratingRow("2026-09-11T06:55:09.577Z")
    );
    expect(backfillEvents()).toMatchObject({ ratings: 2 });
    expect(backfillEvents()).toMatchObject({ ratings: 0 });
  });

  test("--since leaves older ratings out", () => {
    writeRatings(ratingRow("2026-09-10T06:55:09.577Z"));
    expect(backfillEvents("2026-09-11")).toMatchObject({ ratings: 0 });
  });
});
