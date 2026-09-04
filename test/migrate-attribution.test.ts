import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// v5 renames the origin stamp `m` to `machine` on stored records. Nothing ever
// read `m`, so the risk is not a broken consumer — it is a half-migrated file,
// which is why every case below checks what the untouched lines look like after.

let HOME: string;

function writeJsonl(relPath: string, lines: string[]): string {
  const file = resolve(HOME, relPath);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`, "utf-8");
  return file;
}

function readLines(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-migrate-attr-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function migration() {
  const { checkPendingMigrations, runMigrate } = await import("../src/cli/migrate");
  return { pendingMigrations: checkPendingMigrations, runMigrate };
}

describe("v5-attribution-keys", () => {
  test("is pending when a record still stamps origin as m", async () => {
    writeJsonl("memory/state/threads.jsonl", [JSON.stringify({ id: "t1", m: "mach-1" })]);
    const { pendingMigrations } = await migration();
    expect(pendingMigrations().map((p) => p.id)).toContain("v5-attribution-keys");
  });

  test("is NOT pending once records use machine", async () => {
    writeJsonl("memory/state/threads.jsonl", [
      JSON.stringify({ id: "t1", machine: "mach-1" }),
    ]);
    const { pendingMigrations } = await migration();
    expect(pendingMigrations().map((p) => p.id)).not.toContain("v5-attribution-keys");
  });

  test("renames m to machine while preserving every other field", async () => {
    const file = writeJsonl("memory/state/threads.jsonl", [
      JSON.stringify({ id: "t1", m: "mach-1", title: "keep me", status: "open" }),
    ]);
    const { runMigrate } = await migration();
    runMigrate([]);
    const [record] = readLines(file);
    expect(record.machine).toBe("mach-1");
    expect(record.m).toBeUndefined();
    expect(record.title).toBe("keep me");
    expect(record.status).toBe("open");
  });

  test("migrates reflections and every signals jsonl, not just threads", async () => {
    const reflections = writeJsonl(
      "memory/learning/reflections/algorithm-reflections.jsonl",
      [JSON.stringify({ task: "x", m: "mach-1" })]
    );
    const ratings = writeJsonl("memory/signals/ratings.jsonl", [
      JSON.stringify({ type: "rating", m: "mach-1" }),
    ]);
    const { runMigrate } = await migration();
    runMigrate([]);
    expect(readLines(reflections)[0].machine).toBe("mach-1");
    expect(readLines(ratings)[0].machine).toBe("mach-1");
  });

  test("leaves a malformed line exactly as found instead of dropping it", async () => {
    const file = writeJsonl("memory/state/threads.jsonl", [
      "not json at all",
      JSON.stringify({ id: "t1", m: "mach-1" }),
    ]);
    const { runMigrate } = await migration();
    runMigrate([]);
    const [malformed, migrated] = readFileSync(file, "utf-8").trim().split("\n");
    expect(malformed).toBe("not json at all");
    expect(JSON.parse(migrated).machine).toBe("mach-1");
  });

  test("keeps an existing machine field and still drops the stale m", async () => {
    const file = writeJsonl("memory/state/threads.jsonl", [
      JSON.stringify({ id: "t1", m: "old", machine: "authoritative" }),
    ]);
    const { runMigrate } = await migration();
    runMigrate([]);
    expect(readLines(file)[0].machine).toBe("authoritative");
    expect(readLines(file)[0].m).toBeUndefined();
  });

  test("is idempotent — a second run changes nothing", async () => {
    const file = writeJsonl("memory/state/threads.jsonl", [
      JSON.stringify({ id: "t1", m: "mach-1" }),
    ]);
    const { runMigrate, pendingMigrations } = await migration();
    runMigrate([]);
    const after = readFileSync(file, "utf-8");
    runMigrate([]);
    expect(readFileSync(file, "utf-8")).toBe(after);
    expect(pendingMigrations().map((p) => p.id)).not.toContain("v5-attribution-keys");
  });

  test("--dry-run reports without touching the file", async () => {
    const file = writeJsonl("memory/state/threads.jsonl", [
      JSON.stringify({ id: "t1", m: "mach-1" }),
    ]);
    const before = readFileSync(file, "utf-8");
    const { runMigrate } = await migration();
    runMigrate(["--dry-run"]);
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("is not pending when no record files exist at all", async () => {
    expect(existsSync(resolve(HOME, "memory", "state", "threads.jsonl"))).toBe(false);
    const { pendingMigrations } = await migration();
    expect(pendingMigrations().map((p) => p.id)).not.toContain("v5-attribution-keys");
  });
});
