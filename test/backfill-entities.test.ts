import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/core/settings";
import { getOrCreate } from "../src/knowledge/lib";
import { backfillEvents } from "../src/tools/lib/backfill";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

let home: string;

function forgetStreamedEvents(): void {
  removeOnceReleased(resolve(home, "records", "bronze"));
}

function logLines(dir: string): Record<string, unknown>[] {
  const path = resolve(home, "records", "bronze", dir);
  if (!existsSync(path)) return [];

  return readdirSync(path)
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const seen = () => logLines("events").filter((e) => e.type === "entity_first_seen");

function createdBeforeStreaming(name: string): string {
  const created = getOrCreate({ domain: "People", name }).frontmatter.created;
  forgetStreamedEvents();

  return created;
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("knowledge entities become events", () => {
  test("an entity from before streaming is first seen when it was created", () => {
    const created = createdBeforeStreaming("Ada Example");
    expect(backfillEvents()).toMatchObject({ entities: 1 });
    expect(seen()).toEqual([
      expect.objectContaining({
        id: "entity:People:ada-example",
        ts: created,
        domain: "People",
        entityType: "person",
      }),
    ]);
    expect(JSON.stringify(seen())).not.toContain("Ada");
    expect(logLines("event-text").map((c) => c.name)).toEqual(["Ada Example"]);
  });

  test("an entity already seen live is not logged again", () => {
    getOrCreate({ domain: "Companies", name: "Acme Example" });
    expect(backfillEvents()).toMatchObject({ entities: 0 });
    expect(seen()).toHaveLength(1);
  });

  test("a second run appends nothing", () => {
    createdBeforeStreaming("Ada Example");
    backfillEvents();
    expect(backfillEvents()).toMatchObject({ entities: 0 });
  });
});
