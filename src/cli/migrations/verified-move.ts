import { existsSync, mkdirSync, renameSync, rmdirSync, statSync } from "node:fs";
import { basename, dirname, sep } from "node:path";
import { appendEvent, logQuietly } from "../../bronze/events";
import { palHome } from "../../core/paths";
import {
  describeMoves,
  fileLines,
  formatManifest,
  hashMatchesAt,
  hashTotal,
  locationOf,
  type MoveManifestLine,
  newestManifest,
  type PlannedMove,
  readManifest,
  writeManifest,
} from "./move-manifest";

export interface MoveReport {
  outcome: "moved" | "rolled-back" | "refused";
  files: number;
  manifest: string | null;
  reason?: string;
}

export interface UndoReport {
  outcome: "undone" | "nothing-to-undo";
  manifest: string | null;
  putBack: number;
  differ: string[];
  leftInPlace: string[];
}

export interface MoveSeams {
  rename: (from: string, to: string) => void;
  deviceOf: (path: string) => number;
}

const realSeams: MoveSeams = {
  rename: renameSync,
  deviceOf: (path) => statSync(path).dev,
};

export function recordMemoryMove(
  name: string,
  fields: Record<string, unknown>,
  detail?: Record<string, unknown>
): void {
  logQuietly("memory_move", () =>
    appendEvent(
      "memory_move",
      { migration: name, ...fields },
      detail ? { content: detail } : {}
    )
  );
}

function nearestExisting(path: string): string {
  let current = path;

  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);

  return current;
}

function refusalOf(move: PlannedMove, seams: MoveSeams): string | null {
  if (!existsSync(move.from)) return "source missing";

  if (existsSync(move.to)) return "target exists";

  if (seams.deviceOf(move.from) !== seams.deviceOf(nearestExisting(move.to)))
    return "different filesystems";

  return null;
}

/** Why the moves cannot run, checked before anything is written, or null when they can. */
export function moveRefusal(
  moves: PlannedMove[],
  seams: MoveSeams = realSeams
): { reason: string; move: PlannedMove } | null {
  for (const move of moves) {
    const reason = refusalOf(move, seams);
    if (reason) return { reason, move };
  }

  return null;
}

/** The dry run: exactly the manifest a move would write, with nothing changed. */
export function previewMoves(moves: PlannedMove[]): string {
  return formatManifest(describeMoves(moves));
}

function renameInto(from: string, to: string, seams: MoveSeams): void {
  mkdirSync(dirname(to), { recursive: true });
  seams.rename(from, to);
}

function linesOf(move: PlannedMove, lines: MoveManifestLine[]): MoveManifestLine[] {
  return lines.filter((line) => line.from === move.from && line.to === move.to);
}

function differingAt(lines: MoveManifestLine[], side: "from" | "to"): string[] {
  return lines
    .filter((line) => !hashMatchesAt(line, side))
    .map((line) => locationOf(line, side));
}

function removedEmptyFolder(dir: string): boolean {
  try {
    rmdirSync(dir);

    return true;
  } catch {
    return false;
  }
}

/** Removes the folders a rename created for a target, up to the first one that holds something. */
function discardEmptyParents(path: string): void {
  const inside = `${palHome()}${sep}`;
  let dir = dirname(path);

  while (dir.startsWith(inside) && removedEmptyFolder(dir)) dir = dirname(dir);
}

function rollBack(moved: PlannedMove[], seams: MoveSeams): string[] {
  const stuck: string[] = [];

  for (const move of [...moved].reverse()) {
    try {
      seams.rename(move.to, move.from);
      discardEmptyParents(move.to);
    } catch {
      stuck.push(move.to);
    }
  }

  return stuck;
}

function refused(name: string, reason: string, move: PlannedMove): MoveReport {
  recordMemoryMove(name, { outcome: "refused", reason }, { ...move });

  return { outcome: "refused", files: 0, manifest: null, reason };
}

function rolledBack(
  name: string,
  manifest: string,
  moved: PlannedMove[],
  failure: { reason: string; detail: string[] },
  seams: MoveSeams
): MoveReport {
  const stuck = rollBack(moved, seams);
  recordMemoryMove(
    name,
    {
      outcome: "rolled-back",
      entries: moved.length,
      manifest: basename(manifest),
      reason: failure.reason,
    },
    { detail: failure.detail, stuck }
  );

  return { outcome: "rolled-back", files: 0, manifest, reason: failure.reason };
}

function renameError(move: PlannedMove, seams: MoveSeams): string | null {
  try {
    renameInto(move.from, move.to, seams);

    return null;
  } catch (err) {
    return String(err);
  }
}

function moved(
  name: string,
  manifest: string,
  lines: MoveManifestLine[],
  entries: number
): MoveReport {
  const files = fileLines(lines).length;
  recordMemoryMove(name, {
    outcome: "moved",
    entries,
    files,
    bytes: lines.reduce((sum, line) => sum + line.size, 0),
    hashTotal: hashTotal(lines),
    manifest: basename(manifest),
  });

  return { outcome: "moved", files, manifest };
}

/**
 * Renames each move's source onto its target after writing a hashed manifest,
 * re-hashes every moved file, and renames everything back on the first failure.
 */
export function moveVerified(
  name: string,
  moves: PlannedMove[],
  seams: MoveSeams = realSeams
): MoveReport {
  const refusal = moveRefusal(moves, seams);
  if (refusal) return refused(name, refusal.reason, refusal.move);

  const lines = describeMoves(moves);
  const manifest = writeManifest(name, lines);
  const done: PlannedMove[] = [];

  for (const move of moves) {
    const error = renameError(move, seams);
    if (error)
      return rolledBack(
        name,
        manifest,
        done,
        { reason: "rename failed", detail: [error] },
        seams
      );

    done.push(move);
    const differ = differingAt(linesOf(move, lines), "to");
    if (differ.length > 0)
      return rolledBack(
        name,
        manifest,
        done,
        { reason: "hash mismatch", detail: differ },
        seams
      );
  }

  return moved(name, manifest, lines, moves.length);
}

function uniqueMoves(lines: MoveManifestLine[]): PlannedMove[] {
  const seen = new Map<string, PlannedMove>();

  for (const { from, to } of lines) seen.set(`${from}\0${to}`, { from, to });

  return [...seen.values()];
}

function canPutBack(move: PlannedMove): boolean {
  return existsSync(move.to) && !existsSync(move.from);
}

/** Renames every move of the newest manifest of this name back, and names the files that changed since. */
export function undoVerifiedMove(name: string): UndoReport {
  const manifest = newestManifest(name);
  if (!manifest)
    return {
      outcome: "nothing-to-undo",
      manifest: null,
      putBack: 0,
      differ: [],
      leftInPlace: [],
    };

  const lines = readManifest(manifest);
  const moves = uniqueMoves(lines).reverse();
  const back = moves.filter(canPutBack);

  for (const move of back) {
    renameInto(move.to, move.from, realSeams);
    discardEmptyParents(move.to);
  }

  const differ = differingAt(
    back.flatMap((move) => linesOf(move, lines)),
    "from"
  );
  const leftInPlace = moves
    .filter((move) => !back.includes(move) && existsSync(move.to))
    .map((move) => move.to);
  recordMemoryMove(
    name,
    {
      outcome: "undone",
      entries: back.length,
      manifest: basename(manifest),
      differ: differ.length,
    },
    { differ, leftInPlace }
  );

  return { outcome: "undone", manifest, putBack: back.length, differ, leftInPlace };
}
