import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { basename, relative, resolve } from "node:path";
import { appendEvent, logQuietly } from "../../bronze/events";
import { paths } from "../../core/paths";
import { filesUnder, sha256Of } from "./file-hash";
import { discardEmptyFolder, type Migration, type MigrationResult } from "./migration";

/**
 * Hand-made backups under memory/backups move to ~/.pal/backups, beside PAL's own.
 * They are not rebuildable, so the move is renames only, checked file by file:
 * every file's sha256 is written to a manifest first and compared after, and a
 * mismatch renames everything back.
 */

const ID = "v11-memory-backups";

interface ManifestLine {
  entry: string;
  file: string;
  size: number;
  sha256: string;
}

const oldFolder = () => resolve(paths.memory(), "backups");
const newFolder = () => paths.backups();
const manifestPrefix = "memory-backups-";

function entriesToMove(): string[] {
  return existsSync(oldFolder()) ? readdirSync(oldFolder()).sort() : [];
}

function describeEntry(entry: string): ManifestLine[] {
  const root = resolve(oldFolder(), entry);

  return filesUnder(root).map((file) => ({
    entry,
    file: relative(root, file),
    size: statSync(file).size,
    sha256: sha256Of(file),
  }));
}

function sameFilesystem(): boolean {
  return statSync(oldFolder()).dev === statSync(newFolder()).dev;
}

function writeManifest(lines: ManifestLine[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifest = resolve(newFolder(), `${manifestPrefix}${stamp}.manifest.jsonl`);
  appendFileSync(manifest, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));

  return manifest;
}

function hashMatches(line: ManifestLine, folder: string): boolean {
  const file = resolve(folder, line.entry, line.file);

  return existsSync(file) && sha256Of(file) === line.sha256;
}

function renameEntries(
  entries: string[],
  from: string,
  to: string,
  done: string[]
): void {
  for (const entry of entries) {
    renameSync(resolve(from, entry), resolve(to, entry));
    done.push(entry);
  }
}

function withManifestName(fields: Record<string, unknown>): Record<string, unknown> {
  return typeof fields.manifest === "string"
    ? { ...fields, manifest: basename(fields.manifest) }
    : fields;
}

function recordMove(fields: Record<string, unknown>): void {
  logQuietly("memory_move", () =>
    appendEvent("memory_move", { migration: ID, ...withManifestName(fields) })
  );
}

function refused(reason: string): MigrationResult {
  recordMove({ outcome: "refused", reason });

  return {
    migrated: 0,
    skipped: entriesToMove().length,
    results: [`refused: ${reason}`],
  };
}

function rollBack(moved: string[], manifest: string, reason: string): MigrationResult {
  renameEntries(moved, newFolder(), oldFolder(), []);
  recordMove({ outcome: "rolled-back", entries: moved.length, manifest, reason });

  return {
    migrated: 0,
    skipped: moved.length,
    results: [`rolled back: ${reason}; nothing moved, manifest ${manifest}`],
  };
}

/** @lintignore exercised directly by test/memory-cache-out.test.ts */
export function moveVerified(entries: string[], lines: ManifestLine[]): MigrationResult {
  const manifest = writeManifest(lines);
  const moved: string[] = [];

  try {
    renameEntries(entries, oldFolder(), newFolder(), moved);
  } catch (err) {
    return rollBack(moved, manifest, `rename failed: ${String(err)}`);
  }

  const broken = lines.filter((line) => !hashMatches(line, newFolder()));
  if (broken.length > 0)
    return rollBack(moved, manifest, `${broken.length} files differ`);

  discardEmptyFolder(oldFolder());
  const bytes = lines.reduce((sum, line) => sum + line.size, 0);
  recordMove({
    outcome: "moved",
    entries: moved.length,
    files: lines.length,
    bytes,
    manifest,
  });

  return {
    migrated: moved.length,
    skipped: 0,
    results: [
      `moved ${moved.length} entries (${lines.length} files, hashes checked); manifest ${manifest}`,
    ],
  };
}

function entriesFreeAtTarget(): { free: string[]; taken: string[] } {
  const all = entriesToMove();
  const taken = all.filter((entry) => existsSync(resolve(newFolder(), entry)));

  return { free: all.filter((entry) => !taken.includes(entry)), taken };
}

/** @lintignore exercised directly by test/memory-cache-out.test.ts */
export function runMove(
  dryRun: boolean,
  onOneFilesystem: () => boolean = sameFilesystem
): MigrationResult {
  const { free, taken } = entriesFreeAtTarget();
  const skippedNote =
    taken.length > 0 ? [`left in place, name taken: ${taken.join(", ")}`] : [];

  if (free.length === 0)
    return { migrated: 0, skipped: taken.length, results: skippedNote };

  if (dryRun) {
    return {
      migrated: free.length,
      skipped: taken.length,
      results: [`would move ${free.join(", ")} to ${newFolder()}`, ...skippedNote],
    };
  }

  if (!onOneFilesystem())
    return refused("memory/ and backups/ are on different filesystems");
  const result = moveVerified(free, free.flatMap(describeEntry));

  return {
    ...result,
    skipped: result.skipped + taken.length,
    results: [...result.results, ...skippedNote],
  };
}

function newestManifest(): string | null {
  const manifests = readdirSync(newFolder())
    .filter((name) => name.startsWith(manifestPrefix) && name.endsWith(".manifest.jsonl"))
    .sort();
  const last = manifests.at(-1);

  return last ? resolve(newFolder(), last) : null;
}

function parsedManifestLine(line: string): ManifestLine | null {
  try {
    return JSON.parse(line) as ManifestLine;
  } catch {
    return null;
  }
}

function readManifest(manifest: string): ManifestLine[] {
  return readFileSync(manifest, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(parsedManifestLine)
    .filter((line): line is ManifestLine => line !== null);
}

/** Puts the entries of the newest move back under memory/backups, hash-checked. */
function undoBackupsMove(): MigrationResult {
  const manifest = newestManifest();
  if (!manifest) return { migrated: 0, skipped: 0, results: ["no move to undo"] };

  const lines = readManifest(manifest);
  const entries = [...new Set(lines.map((line) => line.entry))].filter(
    (entry) =>
      existsSync(resolve(newFolder(), entry)) && !existsSync(resolve(oldFolder(), entry))
  );
  mkdirSync(oldFolder(), { recursive: true });
  renameEntries(entries, newFolder(), oldFolder(), []);
  const broken = lines.filter(
    (line) => entries.includes(line.entry) && !hashMatches(line, oldFolder())
  );
  recordMove({
    outcome: "undone",
    entries: entries.length,
    manifest,
    reason: `${broken.length} files differ`,
  });

  return {
    migrated: entries.length,
    skipped: 0,
    results: [
      `put back ${entries.length} entries; ${broken.length} files differ from the manifest`,
    ],
  };
}

export const v11MemoryBackups: Migration = {
  id: ID,
  description:
    "Move hand-made backups from memory/backups to ~/.pal/backups, hash-checked",
  movesSources: true,
  check() {
    const pending = entriesFreeAtTarget().free;

    return { pending: pending.length > 0, detail: pending.join(", ") || undefined };
  },
  run: (dryRun = false) => runMove(dryRun),
  undo: undoBackupsMove,
};
