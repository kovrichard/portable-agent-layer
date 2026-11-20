import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  applyPendingMigrations,
  runMigrate,
  runRecorded,
  undoRecorded,
} from "../src/cli/migrate";
import type { Migration } from "../src/cli/migrations/migration";
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

function seedBackups(): void {
  write(at("memory", "backups", "a-snapshot", "notes.md"), "first");
  write(at("memory", "backups", "b-snapshot", "rules.json"), "[1,2,3]");
  mkdirSync(at("backups"), { recursive: true });
}

function linesOf(dir: string, type: string): Record<string, unknown>[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .flatMap((file) => readFileSync(resolve(dir, file), "utf-8").split("\n"))
    .filter((line) => line.includes(`"${type}"`))
    .map((line) => JSON.parse(line));
}

const runEvents = () => linesOf(at("memory", "events"), "migration_run");

function quietly(run: () => void): void {
  const log = spyOn(console, "log").mockImplementation(() => {});

  try {
    run();
  } finally {
    log.mockRestore();
  }
}

function fakeMigration(
  run: Migration["run"]
): Migration & Required<Pick<Migration, "undo">> {
  return {
    id: "fake-migration",
    description: "a fake",
    check: () => ({ pending: true }),
    run,
    undo: () => ({ migrated: 3, skipped: 1, results: ["put back"] }),
  };
}

describe("migration_run events", () => {
  test("install's pending run records one event per migration with its counts", () => {
    seedBackups();

    applyPendingMigrations();

    expect(runEvents()).toEqual([
      expect.objectContaining({
        type: "migration_run",
        migration: "v11-memory-backups",
        outcome: "done",
        migrated: 2,
        skipped: 0,
        dryRun: false,
        undo: false,
        actor: expect.any(String),
      }),
    ]);
  });

  test("a dry run from pal cli migrate is recorded and marked as one", () => {
    seedBackups();

    quietly(() => runMigrate(["--dry-run"]));

    expect(runEvents()).toEqual([
      expect.objectContaining({ migration: "v11-memory-backups", dryRun: true }),
    ]);
    expect(existsSync(at("memory", "backups", "a-snapshot", "notes.md"))).toBe(true);
  });

  test("pal cli migrate --undo records the undo with its counts", () => {
    seedBackups();
    applyPendingMigrations();

    quietly(() => runMigrate(["--undo", "v11-memory-backups"]));

    expect(runEvents().at(-1)).toMatchObject({
      migration: "v11-memory-backups",
      outcome: "done",
      migrated: 2,
      undo: true,
      dryRun: false,
    });
  });

  test("an undo of a migration that has none records nothing", () => {
    quietly(() => runMigrate(["--undo", "v1-projects"]));

    expect(runEvents()).toEqual([]);
  });

  test("the result lines go to the content store, not the event", () => {
    const id = runRecorded(
      fakeMigration(() => ({ migrated: 1, skipped: 0, results: ["moved a thing"] })),
      false
    );

    const stored = linesOf(at("memory", "content", "events"), "migration_run");
    expect(stored).toEqual([
      expect.objectContaining({ results: ["moved a thing"], type: "migration_run" }),
    ]);
    expect(runEvents()[0]).not.toHaveProperty("results");
    expect(id.results).toEqual(["moved a thing"]);
  });

  test("a migration that throws is recorded as failed and the error still surfaces", () => {
    const failing = fakeMigration(() => {
      throw new Error("disk gone");
    });

    expect(() => runRecorded(failing, true)).toThrow("disk gone");
    expect(runEvents()).toEqual([
      expect.objectContaining({
        migration: "fake-migration",
        outcome: "failed",
        dryRun: true,
        undo: false,
      }),
    ]);
  });

  test("an undo is recorded with its own counts", () => {
    const result = undoRecorded(
      fakeMigration(() => ({ migrated: 0, skipped: 0, results: [] }))
    );

    expect(result.results).toEqual(["put back"]);
    expect(runEvents()).toEqual([
      expect.objectContaining({ migrated: 3, skipped: 1, undo: true, outcome: "done" }),
    ]);
  });
});
