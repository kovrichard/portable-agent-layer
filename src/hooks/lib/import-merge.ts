/**
 * Import merge — fold an export archive into an existing PAL home without
 * destroying local records.
 *
 * `extractAllTo(home, true)` overwrites every colliding path, so importing
 * machine A onto machine B silently discards B's side of every append-only log.
 * This module replaces that with a per-type policy:
 *
 *   *.jsonl      union of both sides, deduplicated by exact line
 *   new files    written as-is
 *   identical    no-op
 *   diverged     local kept in place, incoming quarantined under backups/
 *   denylisted   never written (machine identity, rebuildable indexes)
 *
 * Every policy is idempotent: re-importing the same archive is a no-op on the
 * corpus.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type ExportManifest, MANIFEST_NAME } from "./export";

/** One file inside an export archive, decoupled from the zip library. */
export interface ArchiveEntry {
  path: string;
  data(): Buffer;
}

export interface MergeResult {
  created: string[];
  merged: string[];
  identical: string[];
  conflicts: string[];
  skipped: string[];
  linesAdded: number;
  quarantineDir: string | null;
}

/**
 * Paths that must never cross machines. `machine.json` carries this install's
 * identity — importing it would give two machines one id and silently break
 * every origin-scoped read. The retrieval index is rebuilt from its sources.
 */
const NEVER_IMPORT = [
  "machine.json",
  "export-manifest.json",
  "memory/learning/.retrieval-index.json",
];

function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isNeverImport(path: string): boolean {
  const rel = normalize(path);
  return NEVER_IMPORT.some((deny) => rel === deny || rel.endsWith(`/${deny}`));
}

function isJsonl(path: string): boolean {
  return normalize(path).endsWith(".jsonl");
}

function splitLines(raw: string): string[] {
  return raw.split("\n").filter((l) => l.trim().length > 0);
}

/**
 * Union of two JSONL bodies, local order preserved, incoming lines appended
 * only when not already present. Exact-line identity is the dedupe key — no
 * schema is shared across PAL's jsonl files, and every writer serializes a
 * record the same way, so byte equality is the only key that holds for all of
 * them.
 */
export function mergeJsonlLines(
  localRaw: string,
  incomingRaw: string
): { text: string; added: number } {
  const local = splitLines(localRaw);
  const seen = new Set(local);
  const added: string[] = [];
  for (const line of splitLines(incomingRaw)) {
    if (seen.has(line)) continue;
    seen.add(line);
    added.push(line);
  }
  const all = [...local, ...added];
  return { text: all.length > 0 ? `${all.join("\n")}\n` : "", added: added.length };
}

function writeFileEnsuringDir(target: string, data: Buffer | string): void {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

function quarantine(quarantineDir: string, rel: string, data: Buffer): void {
  writeFileEnsuringDir(resolve(quarantineDir, rel), data);
}

/**
 * Merge every archive entry into `home`. `quarantineDir` receives the incoming
 * copy of any file that diverged from its local counterpart, so a conflict
 * loses neither side.
 */
export function mergeArchive(
  entries: ArchiveEntry[],
  home: string,
  quarantineDir: string
): MergeResult {
  const result: MergeResult = {
    created: [],
    merged: [],
    identical: [],
    conflicts: [],
    skipped: [],
    linesAdded: 0,
    quarantineDir: null,
  };

  for (const entry of entries) {
    const rel = normalize(entry.path);
    if (rel.length === 0 || rel.endsWith("/")) continue;

    if (isNeverImport(rel)) {
      result.skipped.push(rel);
      continue;
    }

    const target = resolve(home, rel);
    const incoming = entry.data();

    if (!existsSync(target)) {
      writeFileEnsuringDir(target, incoming);
      result.created.push(rel);
      continue;
    }

    const localRaw = readFileSync(target);
    if (localRaw.equals(incoming)) {
      result.identical.push(rel);
      continue;
    }

    if (isJsonl(rel)) {
      const { text, added } = mergeJsonlLines(
        localRaw.toString("utf-8"),
        incoming.toString("utf-8")
      );
      writeFileSync(target, text);
      result.merged.push(rel);
      result.linesAdded += added;
      continue;
    }

    quarantine(quarantineDir, rel, incoming);
    result.conflicts.push(rel);
    result.quarantineDir = quarantineDir;
  }

  return result;
}

/**
 * The source machine declared by an archive's manifest, or null when the
 * archive predates manifests.
 */
export function readManifest(entries: ArchiveEntry[]): ExportManifest | null {
  const hit = entries.find((e) => normalize(e.path) === MANIFEST_NAME);
  if (!hit) return null;
  try {
    const parsed = JSON.parse(hit.data().toString("utf-8")) as Partial<ExportManifest>;
    if (typeof parsed.machineId !== "string" || parsed.machineId.length === 0)
      return null;
    return {
      machineId: parsed.machineId,
      label: parsed.label ?? parsed.machineId,
      os: parsed.os ?? "",
      exportedAt: parsed.exportedAt ?? "",
      fileCount: parsed.fileCount ?? 0,
    };
  } catch {
    return null;
  }
}

export interface ImportLogEntry {
  ts: string;
  archive: string;
  mode: "merge" | "overwrite";
  created: number;
  merged: number;
  identical: number;
  conflicts: number;
  skipped: number;
  linesAdded: number;
  quarantineDir: string | null;
  sourceMachineId?: string | null;
}

/** Append one record per import so a merged corpus stays attributable. */
export function appendImportLog(home: string, entry: ImportLogEntry): void {
  const logPath = resolve(home, "memory", "state", "import-log.jsonl");
  mkdirSync(dirname(logPath), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  if (existsSync(logPath)) {
    writeFileSync(logPath, readFileSync(logPath, "utf-8") + line);
    return;
  }
  writeFileSync(logPath, line);
}

export function summarize(result: MergeResult): string {
  const parts = [
    `${result.created.length} new`,
    `${result.merged.length} merged (+${result.linesAdded} records)`,
    `${result.identical.length} unchanged`,
  ];
  if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} conflicts`);
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);
  return parts.join(", ");
}
