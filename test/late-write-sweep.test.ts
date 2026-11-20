import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, utimesSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { sweepLateWrites } from "../src/cli/migrations/late-write-sweep";
import {
  memoryMoveDetails,
  memoryMoveEvents,
  writeFile,
} from "./lib/memory-move-fixture";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const at = (...parts: string[]) => resolve(HOME, ...parts);
const read = (...parts: string[]) => readFileSync(at(...parts), "utf-8");

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
});

const folderMove = () => ({
  from: at("memory", "signals"),
  to: at("memory", "bronze", "signals"),
});
const fileMove = () => ({
  from: at("memory", "state", "sessions.json"),
  to: at("memory", "gold", "sessions.json"),
});

function setMtime(path: string, secondsAgo: number): void {
  const when = Date.now() / 1000 - secondsAgo;
  utimesSync(path, when, when);
}

const sweepFolders = () =>
  existsSync(at("backups"))
    ? readdirSync(at("backups")).filter((name) => name.startsWith("layout-sweep-"))
    : [];

describe("sweepLateWrites", () => {
  test("finds nothing, records nothing and keeps nothing when no old path reappeared", () => {
    writeFile(at("memory", "bronze", "signals", "2026-11.jsonl"), "a\n");

    expect(sweepLateWrites("layout", [folderMove(), fileMove()])).toEqual({
      files: 0,
      lines: 0,
      placed: [],
      kept: [],
    });
    expect(memoryMoveEvents(HOME)).toEqual([]);
    expect(sweepFolders()).toEqual([]);
  });

  test("appends only the new lines of a reappeared .jsonl, each once, and keeps the old file", () => {
    writeFile(at("memory", "bronze", "signals", "2026-11.jsonl"), "a\nb\n");
    writeFile(at("memory", "signals", "2026-11.jsonl"), "b\nc\nc\n");

    const report = sweepLateWrites("layout", [folderMove()]);

    expect(read("memory", "bronze", "signals", "2026-11.jsonl")).toBe("a\nb\nc\n");
    expect(report).toMatchObject({ files: 1, lines: 1, placed: [] });
    expect(report.kept).toHaveLength(1);
    expect(readFileSync(report.kept[0], "utf-8")).toBe("b\nc\nc\n");
    expect(report.kept[0]).toStartWith(at("backups", sweepFolders()[0]));
    expect(existsSync(at("memory", "signals"))).toBe(false);
    expect(memoryMoveEvents(HOME)).toEqual([
      expect.objectContaining({
        migration: "layout",
        outcome: "swept",
        files: 1,
        lines: 1,
        kept: 1,
      }),
    ]);
    expect(memoryMoveDetails(HOME)[0]).toMatchObject({ kept: report.kept, placed: [] });
  });

  test("starts the appended lines on their own line", () => {
    writeFile(at("memory", "bronze", "signals", "2026-11.jsonl"), "a");
    writeFile(at("memory", "signals", "2026-11.jsonl"), "c\n");

    sweepLateWrites("layout", [folderMove()]);

    expect(read("memory", "bronze", "signals", "2026-11.jsonl")).toBe("a\nc\n");
  });

  test("appends several new lines each on its own line, to an empty file too", () => {
    writeFile(at("memory", "bronze", "signals", "2026-11.jsonl"), "");
    writeFile(at("memory", "signals", "2026-11.jsonl"), "c\nd\n");

    expect(sweepLateWrites("layout", [folderMove()]).lines).toBe(2);
    expect(read("memory", "bronze", "signals", "2026-11.jsonl")).toBe("c\nd\n");
  });

  test("keeps the moved file when both copies have the same mtime", () => {
    writeFile(at("memory", "gold", "sessions.json"), "moved");
    writeFile(at("memory", "state", "sessions.json"), "late");
    const when = Date.now() / 1000 - 60;
    utimesSync(at("memory", "gold", "sessions.json"), when, when);
    utimesSync(at("memory", "state", "sessions.json"), when, when);

    sweepLateWrites("layout", [fileMove()]);

    expect(read("memory", "gold", "sessions.json")).toBe("moved");
  });

  test("appends nothing when every line is already there", () => {
    writeFile(at("memory", "bronze", "signals", "2026-11.jsonl"), "a");
    writeFile(at("memory", "signals", "2026-11.jsonl"), "a\n");

    expect(sweepLateWrites("layout", [folderMove()]).lines).toBe(0);
    expect(read("memory", "bronze", "signals", "2026-11.jsonl")).toBe("a");
  });

  test("a newer overwritten file wins, and the older one is kept", () => {
    writeFile(at("memory", "gold", "sessions.json"), "moved");
    setMtime(at("memory", "gold", "sessions.json"), 60);
    writeFile(at("memory", "state", "sessions.json"), "late");

    const report = sweepLateWrites("layout", [fileMove()]);

    expect(read("memory", "gold", "sessions.json")).toBe("late");
    expect(report.kept.map((file) => readFileSync(file, "utf-8"))).toEqual(["moved"]);
    expect(report.kept[0]).toEndWith(join(sep, "memory", "gold", "sessions.json"));
  });

  test("an older reappeared file loses, and is kept", () => {
    writeFile(at("memory", "gold", "sessions.json"), "moved");
    writeFile(at("memory", "state", "sessions.json"), "stale");
    setMtime(at("memory", "state", "sessions.json"), 60);

    const report = sweepLateWrites("layout", [fileMove()]);

    expect(read("memory", "gold", "sessions.json")).toBe("moved");
    expect(report.kept.map((file) => readFileSync(file, "utf-8"))).toEqual(["stale"]);
    expect(existsSync(at("memory", "state", "sessions.json"))).toBe(false);
  });

  test("a reappeared file with no counterpart is renamed into place", () => {
    writeFile(at("memory", "bronze", "signals", "2026-11.jsonl"), "a\n");
    writeFile(at("memory", "signals", "2026-12.jsonl"), "z\n");

    const report = sweepLateWrites("layout", [folderMove()]);

    expect(read("memory", "bronze", "signals", "2026-12.jsonl")).toBe("z\n");
    expect(report).toMatchObject({
      files: 1,
      placed: [at("memory", "bronze", "signals", "2026-12.jsonl")],
      kept: [],
    });
  });

  test("removes the old folders it emptied, nested ones too", () => {
    writeFile(at("memory", "bronze", "signals", "x", "a.jsonl"), "a\n");
    writeFile(at("memory", "signals", "x", "a.jsonl"), "b\n");

    sweepLateWrites("layout", [folderMove()]);

    expect(existsSync(at("memory", "signals"))).toBe(false);
    expect(read("memory", "bronze", "signals", "x", "a.jsonl")).toBe("a\nb\n");
  });

  test("a second sweep finds nothing and records nothing more", () => {
    writeFile(at("memory", "bronze", "signals", "2026-11.jsonl"), "a\n");
    writeFile(at("memory", "signals", "2026-11.jsonl"), "b\n");
    sweepLateWrites("layout", [folderMove()]);

    expect(sweepLateWrites("layout", [folderMove()]).files).toBe(0);
    expect(memoryMoveEvents(HOME)).toHaveLength(1);
    expect(read("memory", "bronze", "signals", "2026-11.jsonl")).toBe("a\nb\n");
  });
});
