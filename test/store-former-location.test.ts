import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentArchivePath, movedStores, storeLocation } from "../src/bronze/bronze";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const at = (...parts: string[]) => resolve(HOME, ...parts);
const OLD = () => at("memory", "content", "claude");
const NEW = () => at("records", "raw", "claude");

function touch(...parts: string[]): void {
  mkdirSync(at(...parts.slice(0, -1)), { recursive: true });
  writeFileSync(at(...parts), "{}\n");
}

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

describe("a store that shared its former folder", () => {
  test("is read there only while its own file is there", () => {
    touch("memory", "signals", "interaction", "x.json");
    expect(storeLocation("ratings")).toBe(at("records", "ratings"));
    touch("memory", "signals", "ratings.jsonl");
    expect(storeLocation("ratings")).toBe(at("memory", "signals"));
  });
});

describe("movedStores", () => {
  test("names a whole-folder store with both folders", () => {
    expect(movedStores().filter((m) => m.store === "transcripts")).toEqual([
      { store: "transcripts", from: OLD(), to: NEW() },
    ]);
  });

  test("names each file of a store that shared its folder, and nothing else there", () => {
    touch("memory", "adaptation", "rules.json");
    touch("memory", "adaptation", "turns-2026-10.jsonl");
    touch("memory", "schedules.json");
    touch("memory", "commitments.json");
    const moves = movedStores().filter((m) =>
      ["labelled-turns", "rule-events", "schedules"].includes(m.store)
    );

    expect(moves).toEqual([
      {
        store: "labelled-turns",
        from: at("memory", "adaptation", "turns-2026-10.jsonl"),
        to: at("records", "labelled-turns", "turns-2026-10.jsonl"),
      },
      {
        store: "schedules",
        from: at("memory", "schedules.json"),
        to: at("work", "schedules", "schedules.json"),
      },
    ]);
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

  test("rewrites a store's own file from a folder it shared, and only that file", () => {
    expect(currentArchivePath("memory/signals/ratings.jsonl")).toBe(
      "records/ratings/ratings.jsonl"
    );
    expect(currentArchivePath("memory/schedules.json")).toBe(
      "work/schedules/schedules.json"
    );
    expect(currentArchivePath("memory/commitments.json")).toBe("memory/commitments.json");
    expect(currentArchivePath("memory/adaptation/rules.json")).toBe(
      "memory/adaptation/rules.json"
    );
    expect(currentArchivePath("memory/signals/interaction/x.json")).toBe(
      "memory/signals/interaction/x.json"
    );
  });

  test("leaves every other path alone, including a folder that only starts the same", () => {
    expect(currentArchivePath("memory/wisdom/frames.md")).toBe("memory/wisdom/frames.md");
    expect(currentArchivePath("memory/content/claudette/x")).toBe(
      "memory/content/claudette/x"
    );
  });
});
