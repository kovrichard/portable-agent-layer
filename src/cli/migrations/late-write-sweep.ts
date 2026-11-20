import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { palHome, paths } from "../../core/paths";
import { filesUnder } from "./file-hash";
import { discardEmptyFolder } from "./migration";
import { backupStamp, type PlannedMove } from "./move-manifest";
import { recordMemoryMove } from "./verified-move";

export interface SweepReport {
  files: number;
  lines: number;
  placed: string[];
  kept: string[];
}

interface Sweep extends SweepReport {
  parkDir: string;
}

const lineHash = (line: string) => createHash("sha256").update(line).digest("hex");

function linesIn(file: string): string[] {
  return readFileSync(file, "utf-8").split("\n").filter(Boolean);
}

function appendNewLines(late: string, target: string): number {
  const seen = new Set(linesIn(target).map(lineHash));
  const fresh = linesIn(late).filter((line) => {
    const hash = lineHash(line);
    if (seen.has(hash)) return false;
    seen.add(hash);

    return true;
  });
  if (fresh.length === 0) return 0;

  const current = readFileSync(target, "utf-8");
  const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  appendFileSync(target, `${separator}${fresh.join("\n")}\n`);

  return fresh.length;
}

function renameInto(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

function park(file: string, sweep: Sweep): void {
  const parked = resolve(sweep.parkDir, relative(palHome(), file));
  renameInto(file, parked);
  sweep.kept.push(parked);
}

function settleOverwritten(late: string, target: string, sweep: Sweep): void {
  if (statSync(late).mtimeMs <= statSync(target).mtimeMs) {
    park(late, sweep);

    return;
  }

  park(target, sweep);
  renameInto(late, target);
}

function settle(late: string, target: string, sweep: Sweep): void {
  sweep.files += 1;

  if (!existsSync(target)) {
    renameInto(late, target);
    sweep.placed.push(target);

    return;
  }

  if (!late.endsWith(".jsonl")) {
    settleOverwritten(late, target, sweep);

    return;
  }

  sweep.lines += appendNewLines(late, target);
  park(late, sweep);
}

function discardEmptyFolders(root: string): void {
  if (!existsSync(root) || !statSync(root).isDirectory()) return;

  const folders = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => resolve(item.parentPath, item.name))
    .sort((a, b) => b.length - a.length);

  for (const folder of [...folders, root]) discardEmptyFolder(folder);
}

function sweepMove(move: PlannedMove, sweep: Sweep): void {
  if (!existsSync(move.from)) return;

  for (const late of filesUnder(move.from)) {
    settle(late, resolve(move.to, relative(move.from, late)), sweep);
  }

  discardEmptyFolders(move.from);
}

/**
 * Brings files that reappeared at a move's old paths to the new ones: an
 * append-only .jsonl gives its new lines to the moved file, any other file
 * keeps the newer copy, and every replaced copy is kept under ~/.pal/backups.
 */
export function sweepLateWrites(name: string, moves: PlannedMove[]): SweepReport {
  const sweep: Sweep = {
    files: 0,
    lines: 0,
    placed: [],
    kept: [],
    parkDir: resolve(paths.backups(), `${name}-sweep-${backupStamp()}`),
  };

  for (const move of moves) sweepMove(move, sweep);
  const report = {
    files: sweep.files,
    lines: sweep.lines,
    placed: sweep.placed,
    kept: sweep.kept,
  };

  if (report.files > 0)
    recordMemoryMove(
      name,
      {
        outcome: "swept",
        files: report.files,
        lines: report.lines,
        kept: report.kept.length,
      },
      { placed: report.placed, kept: report.kept }
    );

  return report;
}
