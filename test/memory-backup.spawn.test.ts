import { beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  backupMemoryVerified,
  type TarRunner,
} from "../src/cli/migrations/memory-backup";
import {
  memoryMoveDetails,
  memoryMoveEvents,
  writeFile,
} from "./lib/memory-move-fixture";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const at = (...parts: string[]) => resolve(HOME, ...parts);

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
  writeFile(at("memory", "progress-tree", "events.jsonl"), '{"a":1}\n');
  writeFile(at("memory", "state", "sessions.json"), "{}");
  writeFile(at("memory", "learning", "deep", "notes.md"), "notes");
});

const realTar: TarRunner = (args, cwd) => {
  const result = spawnSync("tar", args, { cwd, encoding: "utf-8" });

  return { status: result.status, stderr: result.stderr };
};

function tarThen(after: (args: string[], cwd: string) => void): TarRunner {
  return (args, cwd) => {
    const result = realTar(args, cwd);
    after(args, cwd);

    return result;
  };
}

const backupsHolding = (suffix: string) =>
  readdirSync(at("backups")).filter((name) => name.endsWith(suffix));

describe("backupMemoryVerified", () => {
  test("archives all of memory/ outside it, checks every file and removes its verify copy", () => {
    const report = backupMemoryVerified();

    expect(report).toMatchObject({ ok: true, files: 3, differ: [] });
    expect(report.archive).toMatch(/memory-\d{4}-\d\d-\d\dT[\d-]+Z\.tar$/);
    expect(backupsHolding(".tar")).toEqual([basename(report.archive)]);
    expect(backupsHolding(".verify")).toEqual([]);
    const listed = spawnSync("tar", ["-tf", report.archive], {
      encoding: "utf-8",
    }).stdout;
    expect(listed).toContain("memory/learning/deep/notes.md");
    expect(memoryMoveEvents(HOME)).toEqual([
      expect.objectContaining({
        migration: "memory-backup",
        outcome: "backed-up",
        files: 3,
        archive: backupsHolding(".tar")[0],
        bytes: expect.any(Number),
      }),
    ]);
  });

  test("refuses when a file changed after it was archived", () => {
    const report = backupMemoryVerified(
      tarThen((args) => {
        if (args[0] === "-cf")
          appendFileSync(at("memory", "state", "sessions.json"), "late");
      })
    );

    expect(report).toMatchObject({
      ok: false,
      reason: "backup differs",
      differ: [join("state", "sessions.json")],
    });
    expect(backupsHolding(".tar")).toHaveLength(1);
    expect(backupsHolding(".verify")).toEqual([]);
    expect(memoryMoveEvents(HOME)).toEqual([
      expect.objectContaining({
        outcome: "refused",
        reason: "backup differs",
        differ: 1,
        files: 3,
      }),
    ]);
    expect(memoryMoveDetails(HOME)[0]).toMatchObject({
      differ: [join("state", "sessions.json")],
    });
  });

  test("refuses when a file is missing from the extracted copy", () => {
    const report = backupMemoryVerified(
      tarThen((args, cwd) => {
        if (args[0] === "-xf")
          unlinkSync(resolve(cwd, args[3], "memory", "learning", "deep", "notes.md"));
      })
    );

    expect(report.differ).toEqual([join("learning", "deep", "notes.md")]);
  });

  test("refuses when the archive cannot be written, and says what tar said", () => {
    const report = backupMemoryVerified(() => ({ status: 2, stderr: "tar: boom\n" }));

    expect(report).toMatchObject({ ok: false, reason: "archive failed", files: 0 });
    expect(memoryMoveEvents(HOME)).toEqual([
      expect.objectContaining({ outcome: "refused", reason: "archive failed" }),
    ]);
    expect(memoryMoveDetails(HOME)[0]).toMatchObject({ error: "tar: boom" });
    expect(backupsHolding(".verify")).toEqual([]);
  });

  test("refuses when the archive cannot be extracted, and removes the verify folder", () => {
    const report = backupMemoryVerified((args, cwd) =>
      args[0] === "-xf" ? { status: 1, stderr: "" } : realTar(args, cwd)
    );

    expect(report).toMatchObject({ ok: false, reason: "extract failed" });
    expect(memoryMoveDetails(HOME)[0]).toMatchObject({ error: "tar exited 1" });
    expect(backupsHolding(".verify")).toEqual([]);
    expect(existsSync(report.archive)).toBe(true);
  });
});
