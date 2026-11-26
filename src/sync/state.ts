/**
 * What this machine remembers between syncs. It never travels: it lives under
 * state/, which the sync's own scope leaves out.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface SyncState {
  /** This machine's manifest counter. */
  counter: number;
  /** Per segment file: bytes already uploaded or known remote, and the last seq. */
  pushed: Record<string, { bytes: number; seq: number; id?: string }>;
  /** Per `<machine>/<fileId>`: the last segment applied here. */
  applied: Record<string, number>;
  /** Per machine: the highest manifest counter verified, to catch a rollback. */
  seen: Record<string, number>;
  /** Per whole file: the content hash and version last agreed with the store. */
  whole: Record<string, { hash: string; version: number }>;
}

const EMPTY: SyncState = { counter: 0, pushed: {}, applied: {}, seen: {}, whole: {} };

const stateFile = (home: string) => resolve(home, "state", "sync", "state.json");

export function readSyncState(home: string): SyncState {
  const file = stateFile(home);
  if (!existsSync(file)) return structuredClone(EMPTY);

  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(file, "utf-8")) };
  } catch {
    throw new Error(`Sync state is not valid JSON: ${file}`);
  }
}

export function writeSyncState(home: string, state: SyncState): void {
  const file = stateFile(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}
