import { beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { LEFTOVERS } from "../src/cli/leftovers";
import { v11MemoryBackups } from "../src/cli/migrations/v11-memory-backups";
import { isNeverImport } from "../src/core/import-merge";
import { isMachineLocalState } from "../src/core/machine-state";
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

const cachesInState = () => {
  const found = LEFTOVERS.find((l) => l.id === "caches-in-state");
  if (!found) throw new Error("no caches-in-state leftover");

  return found;
};

describe("caches-in-state leftover", () => {
  test("moves an old cache file into ~/.pal/cache when the cache has none", () => {
    write(at("memory", "state", "environment.json"), '{"os":"linux"}');

    cachesInState().remove();

    expect(existsSync(at("memory", "state", "environment.json"))).toBe(false);
    expect(readFileSync(at("cache", "environment.json"), "utf-8")).toBe('{"os":"linux"}');
  });

  test("keeps the cache's own copy and drops the old one", () => {
    write(at("memory", "state", "skill-index.json"), "old");
    write(at("cache", "skill-index.json"), "new");

    cachesInState().remove();

    expect(existsSync(at("memory", "state", "skill-index.json"))).toBe(false);
    expect(readFileSync(at("cache", "skill-index.json"), "utf-8")).toBe("new");
  });

  test("removes the empty run-mode folder and leaves a non-empty one", () => {
    mkdirSync(at("memory", "state", "run-mode"), { recursive: true });
    expect(cachesInState().find()).toEqual([at("memory", "state", "run-mode")]);

    write(at("memory", "state", "run-mode", "run.json"), "{}");
    expect(cachesInState().find()).toEqual([]);
  });

  test("finds nothing on a clean install", () => {
    expect(cachesInState().find()).toEqual([]);
  });
});

describe("machine-local state never crosses machines", () => {
  test.each([
    "memory/state/collector-cursors.json",
    "memory/state/transcript-copies.json",
    "memory/state/last-exchange/abc.json",
    "memory/state/auto-update.lock",
  ])("%s is skipped by export and refused by import", (path) => {
    expect(isMachineLocalState(path)).toBe(true);
    expect(isNeverImport(path)).toBe(true);
  });

  test.each([
    "memory/state/sessions.json",
    "memory/state/last-exchange-notes.json",
    "memory/progress-tree/events.jsonl",
  ])("%s still travels", (path) => {
    expect(isMachineLocalState(path)).toBe(false);
    expect(isNeverImport(path)).toBe(false);
  });
});

function seedBackups(): void {
  write(at("memory", "backups", "a-snapshot", "notes.md"), "first");
  write(at("memory", "backups", "a-snapshot", "deep", "data.jsonl"), '{"x":1}\n');
  write(at("memory", "backups", "b-snapshot", "rules.json"), "[1,2,3]");
  mkdirSync(at("backups"), { recursive: true });
}

const manifests = () =>
  readdirSync(at("backups")).filter((name) => name.endsWith(".manifest.jsonl"));

describe("v11-memory-backups", () => {
  test("moves every entry to ~/.pal/backups with its contents intact", () => {
    seedBackups();

    const result = v11MemoryBackups.run(false);

    expect(result.migrated).toBe(2);
    expect(readFileSync(at("backups", "a-snapshot", "deep", "data.jsonl"), "utf-8")).toBe(
      '{"x":1}\n'
    );
    expect(readFileSync(at("backups", "b-snapshot", "rules.json"), "utf-8")).toBe(
      "[1,2,3]"
    );
    expect(existsSync(at("memory", "backups"))).toBe(false);
    expect(v11MemoryBackups.check().pending).toBe(false);
  });

  test("writes a manifest with one hashed line per file before moving", () => {
    seedBackups();

    v11MemoryBackups.run(false);

    const [manifest] = manifests();
    const lines = readFileSync(at("backups", manifest), "utf-8").trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).sha256)).toHaveLength(3);
    expect(JSON.parse(lines[0]).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a dry run changes nothing", () => {
    seedBackups();

    const result = v11MemoryBackups.run(true);

    expect(result.results[0]).toContain("would move");
    expect(existsSync(at("memory", "backups", "a-snapshot", "notes.md"))).toBe(true);
    expect(existsSync(at("backups", "a-snapshot"))).toBe(false);
    expect(manifests()).toEqual([]);
  });

  test("leaves an entry whose name is already taken in place", () => {
    seedBackups();
    write(at("backups", "b-snapshot", "other.txt"), "already here");

    const result = v11MemoryBackups.run(false);

    expect(result.migrated).toBe(1);
    expect(
      readFileSync(at("memory", "backups", "b-snapshot", "rules.json"), "utf-8")
    ).toBe("[1,2,3]");
    expect(readFileSync(at("backups", "b-snapshot", "other.txt"), "utf-8")).toBe(
      "already here"
    );
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "rolls back the entries already moved when a later rename fails",
    () => {
      seedBackups();
      chmodSync(at("memory", "backups", "b-snapshot"), 0o555);

      try {
        const result = v11MemoryBackups.run(false);

        expect(result.migrated).toBe(0);
        expect(result.results[0]).toContain("rolled back");
        expect(
          readFileSync(at("memory", "backups", "a-snapshot", "notes.md"), "utf-8")
        ).toBe("first");
        expect(existsSync(at("backups", "a-snapshot"))).toBe(false);
      } finally {
        chmodSync(at("memory", "backups", "b-snapshot"), 0o755);
      }
    }
  );

  test("undo reports a file that changed since the manifest", () => {
    seedBackups();
    v11MemoryBackups.run(false);
    writeFileSync(at("backups", "b-snapshot", "rules.json"), "tampered");

    const result = v11MemoryBackups.undo?.();

    expect(result?.results[0]).toContain("1 files differ");
  });

  test("undo puts every moved entry back unchanged", () => {
    seedBackups();
    v11MemoryBackups.run(false);

    const result = v11MemoryBackups.undo?.();

    expect(result?.results[0]).toContain("put back 2 entries; 0 files differ");
    expect(
      readFileSync(at("memory", "backups", "a-snapshot", "deep", "data.jsonl"), "utf-8")
    ).toBe('{"x":1}\n');
    expect(existsSync(at("backups", "a-snapshot"))).toBe(false);
  });
});
