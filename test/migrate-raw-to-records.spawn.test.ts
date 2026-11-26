import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { storeDir, storeLocation } from "../src/bronze/bronze";
import {
  applyPendingMigrations,
  checkPendingMigrations,
  runMigrate,
} from "../src/cli/migrate";
import { reload } from "../src/core/settings";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const ID = "v12-raw-to-records";
let HOME: string;

const at = (...parts: string[]) => resolve(HOME, ...parts);
const OLD = (...parts: string[]) => at("memory", "content", "claude", ...parts);
const NEW = (...parts: string[]) => at("records", "raw", "claude", ...parts);

function printedBy(args: string[]): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => lines.push(parts.join(" "));

  try {
    runMigrate(args);
  } finally {
    console.log = original;
  }

  return lines.join("\n");
}

function migrationRuns(): Record<string, unknown>[] {
  const dir = storeDir("events");

  return readdirSync(dir)
    .flatMap((file) => readFileSync(resolve(dir, file), "utf-8").split("\n"))
    .filter((line) => line.includes('"migration_run"'))
    .map((line) => JSON.parse(line));
}

function writeRaw(rel: string, body: string): void {
  mkdirSync(resolve(OLD(rel), ".."), { recursive: true });
  writeFileSync(OLD(rel), body);
}

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
  mkdirSync(at("memory", "state"), { recursive: true });
  reload();
  writeRaw("-proj/s1.jsonl.gz", "first transcript");
  writeRaw("-proj/s1/subagents/agent-a.jsonl.gz", "subagent transcript");
});

describe("before the owner runs it", () => {
  test("install leaves raw transcripts where they are", () => {
    expect(applyPendingMigrations().some((line) => line.startsWith(ID))).toBe(false);
    expect(readFileSync(OLD("-proj/s1.jsonl.gz"), "utf-8")).toBe("first transcript");
    expect(existsSync(NEW())).toBe(false);
  });

  test("the doctor lists it with the command that runs it", () => {
    expect(checkPendingMigrations().find((m) => m.id === ID)?.detail).toBe(
      `run it yourself: pal cli migrate ${ID}`
    );
  });

  test("a bare migrate names it as waiting and moves nothing", () => {
    expect(printedBy([])).toContain(`pal cli migrate ${ID}`);
    expect(existsSync(NEW())).toBe(false);
  });

  test("a dry run names the move and moves nothing", () => {
    expect(printedBy([ID, "--dry-run"])).toContain("records/raw/claude");
    expect(existsSync(OLD("-proj/s1.jsonl.gz"))).toBe(true);
    expect(existsSync(NEW())).toBe(false);
  });
});

describe("run by its owner", () => {
  test("moves every file, byte for byte, and the store reads the new folder", () => {
    expect(printedBy([ID, "--force"])).toContain("hashes checked");
    expect(readFileSync(NEW("-proj/s1.jsonl.gz"), "utf-8")).toBe("first transcript");
    expect(readFileSync(NEW("-proj/s1/subagents/agent-a.jsonl.gz"), "utf-8")).toBe(
      "subagent transcript"
    );
    expect(existsSync(OLD())).toBe(false);
    expect(storeLocation("transcripts")).toBe(NEW());
    expect(checkPendingMigrations().some((m) => m.id === ID)).toBe(false);
  });

  test("a transcript an old process wrote to the old folder afterwards is folded in by the next install", () => {
    printedBy([ID, "--force"]);
    writeRaw("-proj/late.jsonl.gz", "late write");
    const swept = applyPendingMigrations().filter((line) => line.startsWith(ID));
    expect(swept.join("\n")).toContain("swept");
    expect(readFileSync(NEW("-proj/late.jsonl.gz"), "utf-8")).toBe("late write");
    expect(storeLocation("transcripts")).toBe(NEW());
  });

  test("an install with nothing to sweep says nothing about it", () => {
    printedBy([ID, "--force"]);
    expect(applyPendingMigrations().filter((line) => line.startsWith(ID))).toEqual([]);
  });

  test("undo puts the folder back where it was", () => {
    printedBy([ID, "--force"]);
    printedBy(["--undo", ID]);
    expect(readFileSync(OLD("-proj/s1.jsonl.gz"), "utf-8")).toBe("first transcript");
    expect(existsSync(NEW())).toBe(false);
    expect(storeLocation("transcripts")).toBe(OLD());
  });
});

describe("what a named run prints", () => {
  test("a dry run says so before it names the move", () => {
    expect(printedBy([ID, "--dry-run"])).toStartWith(
      `  Dry run — no files will be written.\n\n  Running: ${ID} — `
    );
  });

  test("a real run names the move, prints each result indented and ends with a blank line", () => {
    const printed = printedBy([ID, "--force"]);

    expect(printed).toStartWith(`  Running: ${ID} — `);
    expect(printed).toContain("\n    moved 1 path(s)");
    expect(printed).toEndWith("\n");
  });

  test("a move already done has nothing to do", () => {
    printedBy([ID, "--force"]);
    expect(printedBy([ID, "--force"])).toBe(`  ${ID}: nothing to do.`);
  });

  test("a bare migrate lists it under its own heading until it has run", () => {
    expect(printedBy([])).toContain(
      `  Waiting for you to run them (they move recorded data):\n    pal cli migrate ${ID} — `
    );
    printedBy([ID, "--force"]);
    expect(printedBy([])).not.toContain("Waiting for you");
  });

  test("a sweep that folded files in lands in bronze as a sweep", () => {
    printedBy([ID, "--force"]);
    writeRaw("-proj/late.jsonl.gz", "late write");
    applyPendingMigrations();

    expect(migrationRuns().at(-1)).toMatchObject({
      migration: ID,
      dryRun: false,
      undo: false,
      sweep: true,
    });
  });
});

describe("an unknown name", () => {
  test("lists the migrations there are and runs none", () => {
    const printed = printedBy(["v99-nothing"]);

    expect(printed).toStartWith(`  No migration "v99-nothing". Known: `);
    expect(printed).toContain(`, ${ID}`);
    expect(existsSync(NEW())).toBe(false);
  });
});
