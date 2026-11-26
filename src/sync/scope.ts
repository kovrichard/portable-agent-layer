/**
 * Which files travel between machines, and how. Append-only stores travel as
 * segments of new lines; every other file travels whole. Raw transcripts and
 * machine-local state never leave the machine.
 */

import { existsSync, lstatSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { bronzeStores, storesOutsideBronze } from "../bronze/bronze";
import { EXPORT_DIRS } from "../core/export";
import { palHome } from "../core/paths";

export type SyncKind = "segments" | "whole";

export interface HostedFile {
  path: string;
  kind: SyncKind;
}

/**
 * The ledger rotates its active file, which per-file segments cannot follow;
 * every action is also a bronze event, which does travel.
 */
const LOCAL_ONLY = [
  "records/raw",
  "records/ledger",
  "memory/state",
  "memory/content",
  "memory/downloads",
];

const SEGMENT_LOCATIONS = [...bronzeStores(), ...storesOutsideBronze()]
  .filter((store) => store.appendOnly && store.name !== "ledger")
  .map((store) => store.location);

function staysLocal(path: string): boolean {
  if (LOCAL_ONLY.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
    return true;

  return path.split("/").some((part) => part === "backups" || part.includes(".bak-"));
}

export function syncKindOf(path: string): SyncKind | null {
  if (staysLocal(path) || path.endsWith(".tmp")) return null;
  const inSegmentStore = SEGMENT_LOCATIONS.some((location) =>
    path.startsWith(`${location}/`)
  );

  return inSegmentStore && path.endsWith(".jsonl") ? "segments" : "whole";
}

function filesUnder(home: string, dir: string): string[] {
  const absolute = resolve(home, dir);
  if (!existsSync(absolute) || staysLocal(dir)) return [];

  return readdirSync(absolute).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    const stat = lstatSync(resolve(home, path));
    if (stat.isSymbolicLink()) return [];

    return stat.isDirectory() ? filesUnder(home, path) : [path];
  });
}

/** Every file under the hosted roots that travels, with how it travels. */
export function hostedFiles(home: string = palHome()): HostedFile[] {
  return EXPORT_DIRS.flatMap((root) => filesUnder(home, root)).flatMap((path) => {
    const kind = syncKindOf(path);

    return kind ? [{ path, kind }] : [];
  });
}
