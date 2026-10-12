import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/hooks/lib/settings";
import { backfillEvents } from "../src/tools/lib/backfill";
import { freshTestDir } from "./lib/test-home";

let home: string;

const kept = {
  id: 1,
  title: "a private kept promise",
  due: "2026-09-02T10:00:00.000Z",
  status: "done",
  createdAt: "2026-09-01T10:00:00.000Z",
  closedAt: "2026-09-02T11:00:00.000Z",
  project: "shop",
  snoozes: 1,
  nagCount: 2,
  nagMessageIds: [],
};

const dropped = {
  id: 2,
  title: "a private dropped promise",
  due: "2026-09-05T00:00:00.000Z",
  status: "dropped",
  createdAt: "2026-09-03T00:00:00.000Z",
  closedAt: "2026-09-04T00:00:00.000Z",
  snoozes: 0,
  nagCount: 0,
  nagMessageIds: [],
};

const open = {
  id: 3,
  title: "a private open promise",
  due: "2026-09-10T00:00:00.000Z",
  status: "open",
  createdAt: "2026-09-09T00:00:00.000Z",
  snoozes: 0,
  nagCount: 0,
  nagMessageIds: [],
};

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  reload();
  writeFileSync(
    resolve(home, "memory", "commitments.json"),
    JSON.stringify({ nextId: 4, items: [kept, dropped, open] })
  );
});

function logLines(dir: string): Record<string, unknown>[] {
  const path = resolve(home, dir, "events");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const promises = () => logLines("memory").filter((e) => e.type === "promise");

describe("the bot's promises become events", () => {
  test("each promise is made, and a closed one is done or dropped", () => {
    expect(backfillEvents()).toMatchObject({ promises: 5 });
    expect(promises().map((e) => [e.ts, e.change, e.project])).toEqual([
      ["2026-09-01T10:00:00.000Z", "made", "shop"],
      ["2026-09-02T11:00:00.000Z", "done", "shop"],
      ["2026-09-03T00:00:00.000Z", "made", null],
      ["2026-09-04T00:00:00.000Z", "dropped", null],
      ["2026-09-09T00:00:00.000Z", "made", null],
    ]);
  });

  test("making one records how far off its due time was, closing one how late it was", () => {
    backfillEvents();
    const [made, done, , droppedEarly] = promises();
    expect(made).toMatchObject({ dueInSec: 86_400 });
    expect(done).toMatchObject({ lateSec: 3600, snoozes: 1, nags: 2 });
    expect(droppedEarly).toMatchObject({ lateSec: -86_400 });
  });

  test("the title stays in the content store", () => {
    backfillEvents();
    expect(JSON.stringify(logLines("memory"))).not.toContain("private");
    expect(logLines("memory/content").map((c) => c.title)).toContain(
      "a private kept promise"
    );
  });

  test("a second run appends nothing", () => {
    backfillEvents();
    expect(backfillEvents()).toMatchObject({ promises: 0 });
  });

  test.each([
    "{}",
    "{ half written",
  ])("a store reading %p yields no promises", (store) => {
    writeFileSync(resolve(home, "memory", "commitments.json"), store);
    expect(backfillEvents()).toMatchObject({ promises: 0 });
  });
});
