import { beforeEach, describe, expect, spyOn, test } from "bun:test";
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
import { runMigrate } from "../src/cli/migrate";
import {
  moveVerified,
  runMove,
  v11MemoryBackups,
} from "../src/cli/migrations/v11-memory-backups";
import { collectExportFiles } from "../src/core/export";
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
  test("finds an old cache file and moves it into ~/.pal/cache when the cache has none", () => {
    write(at("memory", "state", "environment.json"), '{"os":"linux"}');
    expect(cachesInState().find()).toEqual([at("memory", "state", "environment.json")]);

    cachesInState().remove();

    expect(existsSync(at("memory", "state", "environment.json"))).toBe(false);
    expect(readFileSync(at("cache", "environment.json"), "utf-8")).toBe('{"os":"linux"}');
    expect(cachesInState().find()).toEqual([]);
  });

  test("keeps the cache's own copy and drops the old one", () => {
    write(at("memory", "state", "skill-index.json"), "old");
    write(at("cache", "skill-index.json"), "new");

    cachesInState().remove();

    expect(existsSync(at("memory", "state", "skill-index.json"))).toBe(false);
    expect(readFileSync(at("cache", "skill-index.json"), "utf-8")).toBe("new");
  });

  test("removes the empty run-mode folder", () => {
    mkdirSync(at("memory", "state", "run-mode"), { recursive: true });
    expect(cachesInState().find()).toEqual([at("memory", "state", "run-mode")]);

    cachesInState().remove();

    expect(existsSync(at("memory", "state", "run-mode"))).toBe(false);
  });

  test("leaves a run-mode folder that still holds a run", () => {
    write(at("memory", "state", "run-mode", "run.json"), "{}");

    cachesInState().remove();

    expect(cachesInState().find()).toEqual([]);
    expect(existsSync(at("memory", "state", "run-mode", "run.json"))).toBe(true);
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
  ])("%s is refused by import", (path) => {
    expect(isMachineLocalState(path)).toBe(true);
    expect(isNeverImport(path)).toBe(true);
  });

  test("import also refuses a Windows-style or ./-prefixed path", () => {
    expect(isNeverImport("memory\\state\\collector-cursors.json")).toBe(true);
    expect(isNeverImport("./memory/state/transcript-copies.json")).toBe(true);
  });

  test.each([
    "memory/state/sessions.json",
    "memory/state/last-exchange-notes.json",
    "memory/state/auto-update.json.old",
    "memory/progress-tree/events.jsonl",
  ])("%s still travels", (path) => {
    expect(isMachineLocalState(path)).toBe(false);
    expect(isNeverImport(path)).toBe(false);
  });

  test("export leaves out machine state and raw content and keeps the rest", () => {
    write(at("memory", "state", "collector-cursors.json"), "{}");
    write(at("memory", "state", "last-exchange", "s1.json"), "{}");
    write(at("memory", "content", "claude", "t.gz"), "x");
    write(at("memory", "state", "sessions.json"), "{}");

    const files = collectExportFiles();

    expect(files).toContain("memory/state/sessions.json");
    expect(files.filter((f) => f.includes("collector-cursors"))).toEqual([]);
    expect(files.filter((f) => f.includes("last-exchange"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("memory/content"))).toEqual([]);
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

function moveEvents(): Record<string, unknown>[] {
  const dir = at("memory", "events");
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .flatMap((file) => readFileSync(resolve(dir, file), "utf-8").split("\n"))
    .filter((line) => line.includes('"memory_move"'))
    .map((line) => JSON.parse(line));
}

describe("v11-memory-backups: moving", () => {
  test("is pending, and names what it will move", () => {
    seedBackups();

    expect(v11MemoryBackups.check()).toEqual({
      pending: true,
      detail: "a-snapshot, b-snapshot",
    });
  });

  test("moves every entry to ~/.pal/backups with its contents intact", () => {
    seedBackups();

    const result = v11MemoryBackups.run();

    expect(result).toMatchObject({ migrated: 2, skipped: 0 });
    expect(result.results[0]).toStartWith("moved 2 entries (3 files, hashes checked)");
    expect(readFileSync(at("backups", "a-snapshot", "deep", "data.jsonl"), "utf-8")).toBe(
      '{"x":1}\n'
    );
    expect(readFileSync(at("backups", "b-snapshot", "rules.json"), "utf-8")).toBe(
      "[1,2,3]"
    );
    expect(existsSync(at("memory", "backups"))).toBe(false);
    expect(v11MemoryBackups.check()).toEqual({ pending: false, detail: undefined });
  });

  test("moves a backup that is a single file, not a folder", () => {
    write(at("memory", "backups", "loose.zip"), "zipped");
    mkdirSync(at("backups"), { recursive: true });

    expect(v11MemoryBackups.run().results[0]).toStartWith("moved 1 entries (1 files");
    expect(readFileSync(at("backups", "loose.zip"), "utf-8")).toBe("zipped");
  });

  test("records the move in bronze with its file and byte counts", () => {
    seedBackups();

    v11MemoryBackups.run(false);

    expect(moveEvents()).toEqual([
      expect.objectContaining({
        type: "memory_move",
        migration: "v11-memory-backups",
        outcome: "moved",
        entries: 2,
        files: 3,
        bytes: 5 + 8 + 7,
      }),
    ]);
  });

  test("names the manifest file in every move event it writes", () => {
    seedBackups();
    v11MemoryBackups.run(false);
    v11MemoryBackups.undo?.();
    moveVerified(
      ["a-snapshot"],
      [{ entry: "a-snapshot", file: "notes.md", size: 5, sha256: "0".repeat(64) }]
    );

    const names = moveEvents().map((event) => event.manifest);
    const first = manifests().sort()[0];
    expect(names.slice(0, 2)).toEqual([first, first]);
    expect(manifests()).toContain(String(names[2]));
  });

  test("writes a stamped manifest with one hashed line per file before moving", () => {
    seedBackups();

    v11MemoryBackups.run(false);

    const [manifest] = manifests();
    expect(manifest).toMatch(
      /^memory-backups-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.manifest\.jsonl$/
    );
    const lines = readFileSync(at("backups", manifest), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a dry run names every entry and changes nothing", () => {
    seedBackups();

    const result = v11MemoryBackups.run(true);

    expect(result.results[0]).toBe(
      `would move a-snapshot, b-snapshot to ${at("backups")}`
    );
    expect(existsSync(at("memory", "backups", "a-snapshot", "notes.md"))).toBe(true);
    expect(existsSync(at("backups", "a-snapshot"))).toBe(false);
    expect(manifests()).toEqual([]);
  });

  test("leaves an entry whose name is already taken in place and counts it skipped", () => {
    seedBackups();
    write(at("backups", "b-snapshot", "other.txt"), "already here");

    const result = v11MemoryBackups.run(false);

    expect(result).toMatchObject({ migrated: 1, skipped: 1 });
    expect(result.results).toContain("left in place, name taken: b-snapshot");
    expect(
      readFileSync(at("memory", "backups", "b-snapshot", "rules.json"), "utf-8")
    ).toBe("[1,2,3]");
  });

  test("does nothing, and writes no manifest, when every name is taken", () => {
    write(at("memory", "backups", "a-snapshot", "notes.md"), "first");
    write(at("backups", "a-snapshot", "x"), "y");
    write(at("backups", "c-snapshot", "x"), "y");

    const result = v11MemoryBackups.run(false);

    expect(result).toEqual({
      migrated: 0,
      skipped: 1,
      results: ["left in place, name taken: a-snapshot"],
    });
    expect(manifests()).toEqual([]);
    expect(v11MemoryBackups.check().pending).toBe(false);
  });

  test("refuses, moves nothing and records why, across filesystems", () => {
    seedBackups();

    const result = runMove(false, () => false);

    expect(result).toEqual({
      migrated: 0,
      skipped: 2,
      results: ["refused: memory/ and backups/ are on different filesystems"],
    });
    expect(existsSync(at("memory", "backups", "a-snapshot", "notes.md"))).toBe(true);
    expect(moveEvents()).toEqual([expect.objectContaining({ outcome: "refused" })]);
  });
});

describe("v11-memory-backups: rolling back", () => {
  test("puts every entry back when a moved file's hash does not match the manifest", () => {
    seedBackups();
    const wrongHash = {
      entry: "b-snapshot",
      file: "rules.json",
      size: 7,
      sha256: "0".repeat(64),
    };

    const result = moveVerified(["a-snapshot", "b-snapshot"], [wrongHash]);

    expect(result.results[0]).toStartWith("rolled back: 1 files differ");
    expect(existsSync(at("memory", "backups", "a-snapshot", "notes.md"))).toBe(true);
    expect(existsSync(at("memory", "backups", "b-snapshot", "rules.json"))).toBe(true);
    expect(existsSync(at("backups", "a-snapshot"))).toBe(false);
    expect(moveEvents()).toEqual([
      expect.objectContaining({ outcome: "rolled-back", entries: 2 }),
    ]);
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "puts back the entries already moved when a later rename fails",
    () => {
      seedBackups();
      chmodSync(at("memory", "backups", "b-snapshot"), 0o555);

      try {
        const result = v11MemoryBackups.run(false);

        expect(result.migrated).toBe(0);
        expect(result.results[0]).toStartWith("rolled back: rename failed");
        expect(
          readFileSync(at("memory", "backups", "a-snapshot", "notes.md"), "utf-8")
        ).toBe("first");
        expect(existsSync(at("backups", "a-snapshot"))).toBe(false);
      } finally {
        chmodSync(at("memory", "backups", "b-snapshot"), 0o755);
      }
    }
  );
});

describe("v11-memory-backups: undo", () => {
  test("says so when there is no move to undo", () => {
    write(at("backups", "pal-backup-1.zip"), "zip");

    expect(v11MemoryBackups.undo?.()).toEqual({
      migrated: 0,
      skipped: 0,
      results: ["no move to undo"],
    });
  });

  test("puts every moved entry back unchanged and records it", () => {
    seedBackups();
    v11MemoryBackups.run(false);

    const result = v11MemoryBackups.undo?.();

    expect(result?.results).toEqual([
      "put back 2 entries; 0 files differ from the manifest",
    ]);
    expect(
      readFileSync(at("memory", "backups", "a-snapshot", "deep", "data.jsonl"), "utf-8")
    ).toBe('{"x":1}\n');
    expect(existsSync(at("backups", "a-snapshot"))).toBe(false);
    expect(moveEvents().at(-1)).toMatchObject({
      outcome: "undone",
      entries: 2,
      reason: "0 files differ",
    });
  });

  test("reports a file that changed since the manifest", () => {
    seedBackups();
    v11MemoryBackups.run(false);
    writeFileSync(at("backups", "b-snapshot", "rules.json"), "tampered");

    expect(v11MemoryBackups.undo?.()?.results[0]).toContain("1 files differ");
  });

  test("reads only the newest manifest and ignores other files in ~/.pal/backups", () => {
    seedBackups();
    v11MemoryBackups.run(false);
    write(at("backups", "pal-backup-zzz.zip"), "zip");
    write(at("backups", "memory-backups-zzz.notes"), "not a manifest");

    expect(v11MemoryBackups.undo?.()?.results[0]).toStartWith("put back 2 entries");
  });

  test("skips a malformed manifest line", () => {
    seedBackups();
    v11MemoryBackups.run(false);
    const [manifest] = manifests();
    writeFileSync(
      at("backups", manifest),
      `${readFileSync(at("backups", manifest), "utf-8")}{not json\n`
    );

    expect(v11MemoryBackups.undo?.()?.results[0]).toStartWith("put back 2 entries");
  });

  test("puts back only what moved, beside an entry that was left in place", () => {
    seedBackups();
    write(at("backups", "b-snapshot", "other.txt"), "already here");
    v11MemoryBackups.run(false);

    const result = v11MemoryBackups.undo?.();

    expect(result?.results[0]).toStartWith("put back 1 entries");
    expect(readFileSync(at("memory", "backups", "a-snapshot", "notes.md"), "utf-8")).toBe(
      "first"
    );
    expect(readFileSync(at("backups", "b-snapshot", "other.txt"), "utf-8")).toBe(
      "already here"
    );
  });
});

function printedBy(args: string[]): string[] {
  const printed: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line?: unknown) => {
    printed.push(String(line));
  });

  try {
    runMigrate(args);
  } finally {
    log.mockRestore();
  }

  return printed;
}

describe("pal cli migrate --undo", () => {
  test("undoes a migration that supports it", () => {
    seedBackups();
    v11MemoryBackups.run(false);

    expect(printedBy(["--undo", "v11-memory-backups"])).toEqual([
      "  put back 2 entries; 0 files differ from the manifest",
    ]);
    expect(existsSync(at("memory", "backups", "a-snapshot", "notes.md"))).toBe(true);
  });

  test("names the undoable migrations when the id cannot be undone", () => {
    expect(printedBy(["--undo", "v1-projects"])).toEqual([
      '  Nothing to undo for "v1-projects". Undoable: v11-memory-backups, v12-raw-to-records, v13-settings-to-root',
    ]);
  });

  test("names them too when no id is given", () => {
    expect(printedBy(["--undo"])[0]).toBe(
      '  Nothing to undo for "". Undoable: v11-memory-backups, v12-raw-to-records, v13-settings-to-root'
    );
  });
});
