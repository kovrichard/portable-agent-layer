import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/hooks/lib/settings";
import { getOrCreate } from "../src/tools/knowledge/lib";
import { backfillEvents } from "../src/tools/lib/backfill";
import { freshTestDir } from "./lib/test-home";

let home: string;

function setEventLog(enabled: boolean): void {
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify({ eventLog: { enabled } })
  );
  reload();
}

function logLines(dir: string): Record<string, unknown>[] {
  const path = resolve(home, dir, "events");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .flatMap((f) => readFileSync(resolve(path, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const seen = () => logLines("memory").filter((e) => e.type === "entity_first_seen");

function createdBeforeStreaming(name: string): string {
  setEventLog(false);
  const created = getOrCreate({ domain: "People", name }).frontmatter.created;
  setEventLog(true);
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
    expect(logLines("memory/content").map((c) => c.name)).toEqual(["Ada Example"]);
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
