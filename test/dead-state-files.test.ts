import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LEFTOVERS } from "../src/cli/leftovers";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const at = (...parts: string[]) => resolve(HOME, ...parts);

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const deadStateFiles = () => {
  const found = LEFTOVERS.find((l) => l.id === "dead-state-files");
  if (!found) throw new Error("no dead-state-files leftover");

  return found;
};

const thread = (status: string) =>
  `${JSON.stringify({ id: "t1", title: "a thread", context: "", status, created: "2026-10-01T00:00:00Z", resolved: null })}\n`;

describe("files no PAL reads any more", () => {
  test.each([
    "memory/state/last-handoff.json",
    "memory/state/signal-cache.json",
    "memory/state/pending-failure.d1e3.json",
    "memory/signals/token-usage.jsonl",
  ])("removes %s", (path) => {
    write(at(path), "{}");

    deadStateFiles().remove();

    expect(existsSync(at(path))).toBe(false);
  });

  test("removes the threads file once every open thread is in the progress tree", () => {
    write(at("memory", "state", "threads.jsonl"), thread("resolved"));

    deadStateFiles().remove();

    expect(existsSync(at("memory", "state", "threads.jsonl"))).toBe(false);
  });

  test("keeps the threads file while v10 still has an open thread to carry over", () => {
    write(at("memory", "state", "threads.jsonl"), thread("open"));

    expect(deadStateFiles().find()).toEqual([]);
    deadStateFiles().remove();

    expect(existsSync(at("memory", "state", "threads.jsonl"))).toBe(true);
  });

  test("removes the empty content folder, never wisdom's state or notes", () => {
    mkdirSync(at("memory", "content"), { recursive: true });
    mkdirSync(at("memory", "wisdom", "state"), { recursive: true });
    write(at("memory", "wisdom", "frames", "workflow.md"), "# frame");

    deadStateFiles().remove();

    expect(existsSync(at("memory", "content"))).toBe(false);
    expect(existsSync(at("memory", "wisdom", "state"))).toBe(true);
    expect(existsSync(at("memory", "wisdom", "frames", "workflow.md"))).toBe(true);
  });

  test("keeps a folder that is not empty and finds nothing on a clean install", () => {
    write(at("memory", "content", "note.md"), "x");

    expect(deadStateFiles().find()).toEqual([]);
  });
});
