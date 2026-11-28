import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contentDir, eventsSince } from "../src/bronze/events";
import { emitBindingChange } from "../src/tools/lib/project-history";
import { freshTestDir } from "./lib/test-home";

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
});

function storedText(id: string): unknown {
  const month = new Date().toISOString().slice(0, 7);

  return readFileSync(resolve(contentDir(), `${month}.jsonl`), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((row) => row.id === id);
}

describe("a binding change in bronze", () => {
  test("is a project event that names the change and keeps the path out of its fields", () => {
    const id = emitBindingChange("alpha", "unbound", "/w/alpha");

    const [event] = eventsSince("project", new Date(0));
    expect(event).toMatchObject({
      id,
      type: "project",
      project: "alpha",
      change: "unbound",
    });
    expect(JSON.stringify(event)).not.toContain("/w/alpha");
    expect(storedText(id as string)).toMatchObject({ type: "project", path: "/w/alpha" });
  });
});
