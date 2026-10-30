import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type HandoffEntry,
  type HandoffStore,
  parseHandoffs,
  readHandoffs,
} from "../src/tools/lib/handoff-note";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
});

const entry = (over: Partial<HandoffEntry> = {}): HandoffEntry => ({
  timestamp: "2026-09-01T00:00:00.000Z",
  title: "t",
  status: "in-progress",
  handoff: "h",
  artifacts: [],
  source: "deliberate",
  ...over,
});

describe("parseHandoffs", () => {
  test("reads the store back", () => {
    const store: HandoffStore = { "/a": entry() };
    expect(parseHandoffs(JSON.stringify(store))).toEqual(store);
  });

  // A corrupt store loses the notes, not the session that was writing one.
  test("unreadable content is an empty store, not a throw", () => {
    expect(parseHandoffs("{not json")).toEqual({});
  });
});

describe("readHandoffs", () => {
  test("a store that was never written is empty", () => {
    expect(readHandoffs(resolve(HOME, "nope.json"))).toEqual({});
  });

  test("reads the file it is pointed at", () => {
    const file = resolve(HOME, "store.json");
    writeFileSync(file, JSON.stringify({ "/a": entry({ title: "kept" }) }));
    expect(readHandoffs(file)["/a"].title).toBe("kept");
  });

  // A path that exists but is not a readable file loses the notes, not the run.
  test("a store that cannot be read at all is empty, not a throw", () => {
    expect(readHandoffs(HOME)).toEqual({});
  });
});
