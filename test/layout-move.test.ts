import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BackupReport } from "../src/cli/migrations/data-backup";
import {
  type LayoutMoveOptions,
  runLayoutMove,
  sweepLayoutMove,
  undoLayoutMove,
} from "../src/cli/migrations/layout-move";
import type { PlannedMove } from "../src/cli/migrations/move-manifest";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);
const ID = "layout-move-test";
const FROM = resolve(HOME, "memory", "old");
const TO = resolve(HOME, "records", "new");
const MOVES: PlannedMove[] = [{ from: FROM, to: TO }];

const okBackup = (): BackupReport => ({
  ok: true,
  archive: "backup.tar",
  files: 2,
  differ: [],
});

const idle: LayoutMoveOptions = {
  backup: okBackup,
  guardSeams: {
    now: () => Date.now(),
    isAlive: () => false,
    freeBytes: () => Number.MAX_SAFE_INTEGER,
  },
};

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  removeOnceReleased(HOME);
  mkdirSync(FROM, { recursive: true });
  writeFileSync(resolve(FROM, "a.jsonl"), '{"a":1}\n');
  writeFileSync(resolve(FROM, "b.jsonl"), '{"b":1}\n');
});

describe("runLayoutMove", () => {
  test("with nothing left to move, says so and moves nothing", () => {
    removeOnceReleased(FROM);

    expect(runLayoutMove(ID, MOVES, false, idle)).toEqual({
      migrated: 0,
      skipped: 0,
      results: ["nothing to move"],
    });
  });

  test("a dry run counts the moves, prints them trimmed and writes nothing", () => {
    const result = runLayoutMove(ID, MOVES, true, idle);

    expect(result.migrated).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(JSON.parse(result.results[0].split("\n")[0]).to).toBe(TO);
    expect(result.results[0]).toBe(result.results[0].trim());
    expect(existsSync(TO)).toBe(false);
  });

  test("refuses on a short disk and leaves the source", () => {
    const short = { ...idle, guardSeams: { ...idle.guardSeams, freeBytes: () => 0 } };
    const result = runLayoutMove(ID, MOVES, false, short);

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0]).toStartWith("refused: not enough disk");
    expect(existsSync(FROM)).toBe(true);
  });

  test("refuses when the backup fails, naming its reason", () => {
    const failing = (reason?: string) => ({
      ...idle,
      backup: () => ({ ...okBackup(), ok: false, reason }),
    });

    expect(runLayoutMove(ID, MOVES, false, failing("tar broke"))).toEqual({
      migrated: 0,
      skipped: 1,
      results: ["refused: backup tar broke"],
    });
    expect(runLayoutMove(ID, MOVES, false, failing()).results).toEqual([
      "refused: backup failed",
    ]);
    expect(existsSync(TO)).toBe(false);
  });

  test("moves the files and reports the count, hashes and backup", () => {
    const result = runLayoutMove(ID, MOVES, false, idle);

    expect(result.migrated).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toStartWith("moved 1 folder(s), 2 files, hashes checked");
    expect(result.results[0]).toEndWith("backup backup.tar");
    expect(readFileSync(resolve(TO, "a.jsonl"), "utf-8")).toBe('{"a":1}\n');
  });
});

describe("undoLayoutMove", () => {
  test("with no move on record, says there is nothing to undo", () => {
    expect(undoLayoutMove(ID)).toEqual({
      migrated: 0,
      skipped: 0,
      results: ["nothing to undo"],
    });
  });

  test("puts the folder back and lists no change when nothing changed", () => {
    runLayoutMove(ID, MOVES, false, idle);
    const result = undoLayoutMove(ID);

    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toStartWith("put back 1 folder(s) from ");
    expect(existsSync(resolve(FROM, "a.jsonl"))).toBe(true);
  });

  test("names a file that changed after the move", () => {
    runLayoutMove(ID, MOVES, false, idle);
    writeFileSync(resolve(TO, "a.jsonl"), '{"a":2}\n');
    const result = undoLayoutMove(ID);

    expect(result.results).toHaveLength(2);
    expect(result.results[1]).toStartWith("changed since: ");
    expect(result.results[1]).toContain("a.jsonl");
  });
});

describe("sweepLayoutMove", () => {
  test("before the move, sweeps nothing", () => {
    expect(sweepLayoutMove(ID, MOVES)).toEqual({ migrated: 0, skipped: 0, results: [] });
  });

  test("an empty old folder after the move reports nothing", () => {
    runLayoutMove(ID, MOVES, false, idle);
    mkdirSync(FROM, { recursive: true });

    expect(sweepLayoutMove(ID, MOVES)).toEqual({ migrated: 0, skipped: 0, results: [] });
  });

  test("folds a late append into the moved file and counts it", () => {
    runLayoutMove(ID, MOVES, false, idle);
    mkdirSync(FROM, { recursive: true });
    writeFileSync(resolve(FROM, "a.jsonl"), '{"a":1}\n{"a":3}\n');
    const result = sweepLayoutMove(ID, MOVES);

    expect(result.migrated).toBe(1);
    expect(result.results).toEqual(["swept 1 late file(s), 1 line(s)"]);
    expect(readFileSync(resolve(TO, "a.jsonl"), "utf-8")).toBe('{"a":1}\n{"a":3}\n');
  });
});
