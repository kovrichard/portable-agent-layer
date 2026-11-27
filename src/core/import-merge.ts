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
 *   other actor  incoming adopted, local quarantined and kept as an alias
 *   denylisted   never written (machine identity, rebuildable indexes)
 *
 * Every policy is idempotent: re-importing the same archive is a no-op on the
 * corpus.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ACTOR_PATH, isOtherActor } from "./actor";
import { type ExportManifest, MANIFEST_NAME } from "./export-manifest";
import { isMachineLocalState } from "./machine-state";

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
  /** This install's actor.json body, when the incoming actor replaced it. */
  replacedActor: string | null;
  skipped: string[];
  linesAdded: number;
  quarantineDir: string | null;
}

/**
 * Paths that must never cross machines. `machine.json` carries this install's
 * identity — importing it would give two machines one id and silently break
 * every origin-scoped read. The retrieval index is a cache older versions wrote.
 */
const NEVER_IMPORT = [
  "machine.json",
  "export-manifest.json",
  "memory/learning/.retrieval-index.json",
];

/** Folders that stay on their machine: its working state, and its raw transcripts. */
const NEVER_IMPORT_FOLDERS = ["state/", "records/raw/"];

function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isNeverImport(path: string): boolean {
  const rel = normalize(path);

  return (
    NEVER_IMPORT.some((deny) => rel === deny || rel.endsWith(`/${deny}`)) ||
    NEVER_IMPORT_FOLDERS.some((folder) => rel.startsWith(folder)) ||
    isMachineLocalState(rel)
  );
}

function isJsonl(path: string): boolean {
  return normalize(path).endsWith(".jsonl");
}

function splitLines(raw: string): string[] {
  return raw.split("\n").filter((l) => l.trim().length > 0);
}

/** The incoming lines the local body lacks, each once, in incoming order. */
export function linesNotIn(localRaw: string, incomingRaw: string): string[] {
  const seen = new Set(splitLines(localRaw));
  const added: string[] = [];

  for (const line of splitLines(incomingRaw)) {
    if (seen.has(line)) continue;
    seen.add(line);
    added.push(line);
  }

  return added;
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
  const added = linesNotIn(localRaw, incomingRaw);
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
 * How archive paths meet this machine's folders: `canonical` rewrites an older
 * layout's path to today's, which the deny list checks; `here` names where that
 * store lives on this machine, which may still be its former folder.
 */
export interface ArchiveLayout {
  canonical(path: string): string;
  here(path: string): string;
}

const SAME_LAYOUT: ArchiveLayout = { canonical: (path) => path, here: (path) => path };

/**
 * Merge every archive entry into `home`. `quarantineDir` receives the incoming
 * copy of any file that diverged from its local counterpart, so a conflict
 * loses neither side.
 */
export function mergeArchive(
  entries: ArchiveEntry[],
  home: string,
  quarantineDir: string,
  layout: ArchiveLayout = SAME_LAYOUT
): MergeResult {
  const result: MergeResult = {
    created: [],
    merged: [],
    identical: [],
    conflicts: [],
    replacedActor: null,
    skipped: [],
    linesAdded: 0,
    quarantineDir: null,
  };

  for (const entry of entries) {
    const canonical = layout.canonical(normalize(entry.path));
    if (canonical.length === 0 || canonical.endsWith("/")) continue;

    if (isNeverImport(canonical)) {
      result.skipped.push(canonical);
      continue;
    }

    const rel = layout.here(canonical);
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

    settleDiverged(result, quarantineDir, { rel, target, localRaw, incoming });
  }

  return result;
}

interface Diverged {
  rel: string;
  target: string;
  localRaw: Buffer;
  incoming: Buffer;
}

function settleDiverged(result: MergeResult, quarantineDir: string, file: Diverged) {
  result.quarantineDir = quarantineDir;

  if (adoptsActor(file)) {
    quarantine(quarantineDir, `${file.rel}.local`, file.localRaw);
    writeFileSync(file.target, file.incoming);
    result.replacedActor = file.localRaw.toString("utf-8");

    return;
  }

  quarantine(quarantineDir, file.rel, file.incoming);
  result.conflicts.push(file.rel);
}

function adoptsActor({ rel, localRaw, incoming }: Diverged): boolean {
  return (
    normalize(rel) === ACTOR_PATH &&
    isOtherActor(localRaw.toString("utf-8"), incoming.toString("utf-8"))
  );
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
      layout: typeof parsed.layout === "number" ? parsed.layout : 1,
    };
  } catch {
    return null;
  }
}

export function summarize(result: MergeResult): string {
  const parts = [
    `${result.created.length} new`,
    `${result.merged.length} merged (+${result.linesAdded} records)`,
    `${result.identical.length} unchanged`,
  ];

  if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} conflicts`);

  if (result.replacedActor) parts.push("adopted the incoming actor");

  if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);

  return parts.join(", ");
}
