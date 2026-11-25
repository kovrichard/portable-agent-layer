import { existsSync } from "node:fs";
import { paths } from "../../core/paths";
import { type BackupReport, backupDataVerified } from "./data-backup";
import { sweepLateWrites } from "./late-write-sweep";
import type { MigrationResult } from "./migration";
import { type GuardSeams, moveGuardRefusal } from "./move-guards";
import { newestManifest, type PlannedMove } from "./move-manifest";
import { moveVerified, previewMoves, undoVerifiedMove } from "./verified-move";

export interface LayoutMoveOptions {
  force?: boolean;
  guardSeams?: Partial<GuardSeams>;
  backup?: () => BackupReport;
}

/** Moves whose source is still there and whose target is not: the work left to do. */
export function movesLeft(moves: PlannedMove[]): PlannedMove[] {
  return moves.filter((move) => existsSync(move.from) && !existsSync(move.to));
}

function nothing(results: string[]): MigrationResult {
  return { migrated: 0, skipped: 0, results };
}

function refusal(results: string[], skipped: number): MigrationResult {
  return { migrated: 0, skipped, results };
}

/**
 * The owner-run move of recorded data: refuse while PAL is busy or the disk is
 * short, take a verified backup of every data folder, then rename with a hashed
 * manifest that rolls back on any mismatch.
 */
export function runLayoutMove(
  id: string,
  moves: PlannedMove[],
  dryRun: boolean,
  options: LayoutMoveOptions = {}
): MigrationResult {
  const left = movesLeft(moves);
  if (left.length === 0) return nothing(["nothing to move"]);

  if (dryRun)
    return { migrated: left.length, skipped: 0, results: [previewMoves(left).trim()] };

  const guard = moveGuardRefusal(id, { force: options.force, seams: options.guardSeams });
  if (guard) return refusal([`refused: ${guard}`], left.length);

  const backup = (options.backup ?? backupDataVerified)();
  if (!backup.ok)
    return refusal([`refused: backup ${backup.reason ?? "failed"}`], left.length);

  const report = moveVerified(id, left);
  if (report.outcome !== "moved")
    return refusal(
      [`${report.outcome}: ${report.reason ?? ""}; backup ${backup.archive}`],
      left.length
    );

  return {
    migrated: left.length,
    skipped: 0,
    results: [
      `moved ${left.length} path(s), ${report.files} files, hashes checked; manifest ${report.manifest}; backup ${backup.archive}`,
    ],
  };
}

export function undoLayoutMove(id: string): MigrationResult {
  const report = undoVerifiedMove(id);
  if (report.outcome === "nothing-to-undo") return nothing(["nothing to undo"]);

  const differ =
    report.differ.length > 0 ? [`changed since: ${report.differ.join(", ")}`] : [];

  return {
    migrated: report.putBack,
    skipped: report.leftInPlace.length,
    results: [`put back ${report.putBack} path(s) from ${report.manifest}`, ...differ],
  };
}

/** Only a move that ran leaves a manifest; a home where both paths merely exist was never moved. */
function moveRan(id: string): boolean {
  return existsSync(paths.backups()) && newestManifest(id) !== null;
}

/** Files that reappeared at an old path after the move, folded into the new one. */
export function sweepLayoutMove(id: string, moves: PlannedMove[]): MigrationResult {
  if (!moveRan(id)) return nothing([]);
  const done = moves.filter((move) => existsSync(move.to) && existsSync(move.from));
  if (done.length === 0) return nothing([]);

  const report = sweepLateWrites(id, done);

  return {
    migrated: report.files,
    skipped: 0,
    results:
      report.files > 0
        ? [`swept ${report.files} late file(s), ${report.lines} line(s)`]
        : [],
  };
}
