import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { currentArchivePath, movedStores, storeLocation } from "../src/bronze/bronze";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const at = (...parts: string[]) => resolve(HOME, ...parts);
const OLD = () => at("memory", "content", "claude");
const NEW = () => at("records", "raw", "claude");

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
});

describe("a store whose move the owner has not run yet", () => {
  test("a new home writes to the new folder", () => {
    expect(storeLocation("transcripts")).toBe(NEW());
  });

  test("a home that still has the former folder keeps using it", () => {
    mkdirSync(OLD(), { recursive: true });
    expect(storeLocation("transcripts")).toBe(OLD());
  });

  test("once the new folder exists it wins, even when a late write recreated the old one", () => {
    mkdirSync(OLD(), { recursive: true });
    mkdirSync(NEW(), { recursive: true });
    expect(storeLocation("transcripts")).toBe(NEW());
  });

  test("a store that never moved has one folder", () => {
    mkdirSync(at("memory", "content", "claude"), { recursive: true });
    expect(storeLocation("events")).toBe(at("memory", "events"));
  });
});

describe("movedStores", () => {
  test("names each store with a former folder and both folders", () => {
    expect(movedStores()).toEqual([{ store: "transcripts", from: OLD(), to: NEW() }]);
  });
});

describe("currentArchivePath", () => {
  test("rewrites a path from a store's former folder to its current one", () => {
    expect(currentArchivePath("memory/content/claude/-p/s.jsonl.gz")).toBe(
      "records/raw/claude/-p/s.jsonl.gz"
    );
    expect(currentArchivePath("memory\\content\\claude\\s.gz")).toBe(
      "records/raw/claude/s.gz"
    );
  });

  test("leaves every other path alone, including a folder that only starts the same", () => {
    expect(currentArchivePath("memory/signals/ratings.jsonl")).toBe(
      "memory/signals/ratings.jsonl"
    );
    expect(currentArchivePath("memory/content/claudette/x")).toBe(
      "memory/content/claudette/x"
    );
  });
});
