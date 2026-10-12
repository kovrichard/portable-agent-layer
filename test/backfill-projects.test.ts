import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeProject } from "../src/hooks/lib/projects";
import { reload } from "../src/hooks/lib/settings";
import { backfillEvents } from "../src/tools/lib/backfill";
import { freshTestDir } from "./lib/test-home";

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  reload();
  writeProject({
    name: "shop",
    status: "active",
    created: "2026-08-01T09:30:00.000Z",
    updated: "2026-09-01T09:30:00.000Z",
    criteria: "- [ ] ISC-3: an open private criterion",
    changelog: [
      "### Archived 2026-08-10",
      "- [x] ISC-1: a private done criterion",
      "",
      "### Retired 2026-08-12",
      "- [~] ISC-2: a private retired criterion",
    ].join("\n"),
    decisions: [
      "- 2026-08-05: A private decision",
      "Its private continuation line",
      "- 2026-08-06: Another private decision",
    ].join("\n"),
  });
});

function logLines(dir: string): Record<string, unknown>[] {
  const path = resolve(home, dir, "events");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const ofType = (type: string) => logLines("memory").filter((e) => e.type === type);

describe("project history becomes events", () => {
  test("a project is registered at its creation time", () => {
    expect(backfillEvents()).toMatchObject({ projects: 5 });
    expect(ofType("project")).toEqual([
      expect.objectContaining({
        id: "project:shop:registered",
        ts: "2026-08-01T09:30:00.000Z",
        project: "shop",
        change: "registered",
        status: "active",
      }),
    ]);
  });

  test("an ISC closes or retires on the day its archive heading names", () => {
    backfillEvents();
    expect(ofType("isc")).toEqual([
      expect.objectContaining({
        ts: "2026-08-10T00:00:00.000Z",
        project: "shop",
        isc: 1,
        change: "done",
      }),
      expect.objectContaining({
        ts: "2026-08-12T00:00:00.000Z",
        isc: 2,
        change: "retired",
      }),
    ]);
  });

  test("each dated decision is one event, its text kept as content", () => {
    backfillEvents();
    expect(ofType("decision")).toEqual([
      expect.objectContaining({ ts: "2026-08-05T00:00:00.000Z", words: 3 }),
      expect.objectContaining({ ts: "2026-08-06T00:00:00.000Z", words: 3 }),
    ]);
    expect(JSON.stringify(logLines("memory"))).not.toContain("private");
    expect(logLines("memory/content").map((c) => c.text)).toEqual(
      expect.arrayContaining(["A private decision", "a private done criterion"])
    );
  });

  test("a second run appends nothing", () => {
    backfillEvents();
    expect(backfillEvents()).toMatchObject({ projects: 0 });
  });
});
