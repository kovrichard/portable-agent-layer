import { beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { backupDataVerified, type TarRunner } from "../src/cli/migrations/data-backup";
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

describe("backupDataVerified", () => {
  test("archives every data folder outside it, checks every file and removes its verify copy", () => {
    const report = backupDataVerified();

    expect(report).toMatchObject({ ok: true, files: 3, differ: [] });
    expect(report.archive).toMatch(/data-\d{4}-\d\d-\d\dT[\d-]+Z\.tar$/);
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
    const report = backupDataVerified(
      tarThen((args) => {
        if (args[0] === "-cf")
          appendFileSync(at("memory", "state", "sessions.json"), "late");
      })
    );

    expect(report).toMatchObject({
      ok: false,
      reason: "backup differs",
      differ: [join("memory", "state", "sessions.json")],
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
      differ: [join("memory", "state", "sessions.json")],
    });
  });

  test("refuses when a file is missing from the extracted copy", () => {
    const report = backupDataVerified(
      tarThen((args, cwd) => {
        if (args[0] === "-xf")
          unlinkSync(resolve(cwd, args[3], "memory", "learning", "deep", "notes.md"));
      })
    );

    expect(report.differ).toEqual([join("memory", "learning", "deep", "notes.md")]);
  });

  test("refuses when the archive cannot be written, and says what tar said", () => {
    const report = backupDataVerified(() => ({ status: 2, stderr: "tar: boom\n" }));

    expect(report).toMatchObject({ ok: false, reason: "archive failed", files: 0 });
    expect(memoryMoveEvents(HOME)).toEqual([
      expect.objectContaining({ outcome: "refused", reason: "archive failed" }),
    ]);
    expect(memoryMoveDetails(HOME)[0]).toMatchObject({ error: "tar: boom" });
    expect(backupsHolding(".verify")).toEqual([]);
  });

  test("refuses when the archive cannot be extracted, and removes the verify folder", () => {
    const report = backupDataVerified((args, cwd) =>
      args[0] === "-xf" ? { status: 1, stderr: "" } : realTar(args, cwd)
    );

    expect(report).toMatchObject({ ok: false, reason: "extract failed" });
    expect(memoryMoveDetails(HOME)[0]).toMatchObject({ error: "tar exited 1" });
    expect(backupsHolding(".verify")).toEqual([]);
    expect(existsSync(report.archive)).toBe(true);
  });

  test("archives records/, work/ and state/ beside memory/, and checks their files too", () => {
    writeFile(at("records", "raw", "p", "t.gz"), "raw");
    writeFile(at("work", "commitments.json"), "[]");
    writeFile(at("state", "cursor.json"), "{}");

    const report = backupDataVerified(
      tarThen((args) => {
        if (args[0] === "-cf") appendFileSync(at("records", "raw", "p", "t.gz"), "late");
      })
    );

    expect(report).toMatchObject({
      ok: false,
      files: 6,
      differ: [join("records", "raw", "p", "t.gz")],
    });
    const listed = spawnSync("tar", ["-tf", report.archive], {
      encoding: "utf-8",
    }).stdout;
    expect(listed).toContain("work/commitments.json");
    expect(listed).toContain("state/cursor.json");
  });

  test("leaves out a data folder that does not exist yet", () => {
    const report = backupDataVerified();
    const listed = spawnSync("tar", ["-tf", report.archive], {
      encoding: "utf-8",
    }).stdout;

    expect(report).toMatchObject({ ok: true, files: 3 });
    expect(listed).not.toContain("records");
  });
});
