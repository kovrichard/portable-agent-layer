import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reload } from "../src/hooks/lib/settings";
import { getOrCreate, save } from "../src/tools/knowledge/lib";
import { freshTestDir } from "./lib/test-home";

const savedHome = process.env.PAL_HOME;
let home: string;

function lines(store: "events" | "content/events"): Record<string, unknown>[] {
  const file = resolve(
    home,
    "memory",
    store,
    `${new Date().toISOString().slice(0, 7)}.jsonl`
  );
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "entity_first_seen");
}

beforeEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  reload();
});

describe("an entity", () => {
  test("is logged the first time it is saved, never again", () => {
    const ada = getOrCreate({ domain: "People", name: "Ada Example" });
    getOrCreate({ domain: "People", name: "Ada Example" });
    save({ ...ada, body: "met again" });
    getOrCreate({ domain: "Companies", name: "Acme Example" });
    expect(lines("events").map((e) => [e.domain, e.entityType])).toEqual([
      ["People", "person"],
      ["Companies", "company"],
    ]);
  });

  test("keeps its name in the content store, out of the event", () => {
    getOrCreate({ domain: "People", name: "Ada Example" });
    expect(JSON.stringify(lines("events"))).not.toContain("Ada");
    expect(lines("content/events")[0]?.name).toBe("Ada Example");
  });

  test("saved into a store of its own is not first seen in the user's", () => {
    getOrCreate({ domain: "People", name: "Ada Example" }, resolve(home, "elsewhere"));
    expect(lines("events")).toEqual([]);
  });
});
