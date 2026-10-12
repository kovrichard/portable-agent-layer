/**
 * How far each collector has read, per source, so a second run emits nothing
 * the first one already did.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../../../hooks/lib/paths";

export type SourceCursor = Record<string, number>;

function cursorsFile(): string {
  return resolve(paths.state(), "collector-cursors.json");
}

function readAll(): Record<string, SourceCursor> {
  if (!existsSync(cursorsFile())) return {};
  try {
    return JSON.parse(readFileSync(cursorsFile(), "utf-8"));
  } catch {
    return {};
  }
}

export function readCursor(source: string): SourceCursor {
  return readAll()[source] ?? {};
}

export function writeCursor(source: string, cursor: SourceCursor): void {
  writeFileSync(
    cursorsFile(),
    `${JSON.stringify({ ...readAll(), [source]: cursor }, null, 2)}\n`
  );
}
