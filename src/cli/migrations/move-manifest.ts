import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { paths } from "../../core/paths";
import { filesUnder, sha256Of } from "./file-hash";

export interface PlannedMove {
  from: string;
  to: string;
}

export interface MoveManifestLine {
  from: string;
  to: string;
  file: string;
  size: number;
  sha256: string;
  folder?: true;
}

const STAMP = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.manifest\.jsonl$/;

export function backupStamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function emptyFoldersUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [];

  const folders = readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => resolve(item.parentPath, item.name));

  return [path, ...folders].filter((folder) => readdirSync(folder).length === 0);
}

function describeMove(move: PlannedMove): MoveManifestLine[] {
  const files = filesUnder(move.from).map((file) => ({
    from: move.from,
    to: move.to,
    file: relative(move.from, file),
    size: statSync(file).size,
    sha256: sha256Of(file),
  }));
  const folders = emptyFoldersUnder(move.from).map((folder) => ({
    from: move.from,
    to: move.to,
    file: relative(move.from, folder),
    size: 0,
    sha256: "",
    folder: true as const,
  }));

  return [...files, ...folders];
}

export function fileLines(lines: MoveManifestLine[]): MoveManifestLine[] {
  return lines.filter((line) => !line.folder);
}

export function describeMoves(moves: PlannedMove[]): MoveManifestLine[] {
  return moves.flatMap(describeMove);
}

export function formatManifest(lines: MoveManifestLine[]): string {
  return lines.map((line) => `${JSON.stringify(line)}\n`).join("");
}

export function writeManifest(name: string, lines: MoveManifestLine[]): string {
  const manifest = resolve(paths.backups(), `${name}-${backupStamp()}.manifest.jsonl`);
  writeFileSync(manifest, formatManifest(lines), { flag: "wx" });

  return manifest;
}

function isManifestOf(name: string, file: string): boolean {
  return file.startsWith(`${name}-`) && STAMP.test(file.slice(name.length + 1));
}

export function newestManifest(name: string): string | null {
  const newest = readdirSync(paths.backups())
    .filter((file) => isManifestOf(name, file))
    .sort()
    .at(-1);

  return newest ? resolve(paths.backups(), newest) : null;
}

function parsedLine(line: string): MoveManifestLine[] {
  try {
    return [JSON.parse(line) as MoveManifestLine];
  } catch {
    return [];
  }
}

export function readManifest(manifest: string): MoveManifestLine[] {
  return readFileSync(manifest, "utf-8").split("\n").filter(Boolean).flatMap(parsedLine);
}

export function locationOf(line: MoveManifestLine, side: "from" | "to"): string {
  return resolve(line[side], line.file);
}

export function hashMatchesAt(line: MoveManifestLine, side: "from" | "to"): boolean {
  const file = locationOf(line, side);
  if (!existsSync(file)) return false;

  return line.folder ? statSync(file).isDirectory() : sha256Of(file) === line.sha256;
}

/** One hash over every file's hash, so two runs over the same files can be compared at a glance. */
export function hashTotal(lines: MoveManifestLine[]): string {
  const total = createHash("sha256");

  for (const line of lines) total.update(`${line.file}\0${line.sha256}\n`);

  return total.digest("hex");
}
