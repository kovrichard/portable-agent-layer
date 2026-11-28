import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contentDir, eventsSince } from "../src/bronze/events";
import { bindingChanges, writeBindings } from "../src/progress/bindings";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
});

function storedText(id: string): unknown {
  const month = new Date().toISOString().slice(0, 7);

  return readFileSync(resolve(contentDir(), `${month}.jsonl`), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((row) => row.id === id);
}

describe("bindingChanges", () => {
  test("a new or moved binding is bound, a dropped one unbound, an unchanged one nothing", () => {
    const before = { kept: "/k", moved: "/old", dropped: "/d" };
    const after = { kept: "/k", moved: "/new", added: "/a" };

    expect(bindingChanges(before, after)).toEqual([
      { project: "moved", change: "bound", path: "/new" },
      { project: "added", change: "bound", path: "/a" },
      { project: "dropped", change: "unbound", path: "/d" },
    ]);
  });
});

describe("a binding write in bronze", () => {
  test("logs each change as a project event, the path in event text only", () => {
    writeBindings({ alpha: "/w/alpha" }, HOME);
    writeBindings({}, HOME);

    const events = eventsSince("project", new Date(0));
    expect(events.map((e) => [e.project, e.change])).toEqual([
      ["alpha", "bound"],
      ["alpha", "unbound"],
    ]);
    expect(JSON.stringify(events)).not.toContain("/w/alpha");
    expect(storedText(events[1].id)).toMatchObject({ type: "project", path: "/w/alpha" });
  });

  test("rewriting the same bindings, as every project save does, logs nothing", () => {
    writeBindings({ alpha: "/w/alpha" }, HOME);
    writeBindings({ alpha: "/w/alpha" }, HOME);

    expect(eventsSince("project", new Date(0))).toHaveLength(1);
  });
});
