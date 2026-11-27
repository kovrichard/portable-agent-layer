/**
 * What the statusline shows about sync: a run in progress, or a problem that
 * needs the user. A healthy, idle sync shows nothing.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SyncResult } from "./context";

export interface SyncStatus {
  running: boolean;
  /** Epoch seconds, so a shell statusline compares it with `date +%s`. */
  startedAt?: number;
  lastSuccessAt?: string;
  notice: string | null;
}

export type RunOutcome = { result: SyncResult } | { error: string };

const SILENT_FAILURE_MS = 24 * 60 * 60_000;
const MAX_ERROR_CHARS = 80;

export const syncStatusFile = (home: string) => resolve(home, "cache", "sync.json");

export function quarantineCount(home: string): number {
  const dir = resolve(home, "backups", "sync-quarantine");

  return existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
        .length
    : 0;
}

export function readSyncStatus(home: string): SyncStatus {
  try {
    return JSON.parse(readFileSync(syncStatusFile(home), "utf-8")) as SyncStatus;
  } catch {
    return { running: false, notice: null };
  }
}

function writeSyncStatus(home: string, status: SyncStatus): void {
  mkdirSync(dirname(syncStatusFile(home)), { recursive: true });
  writeFileSync(syncStatusFile(home), `${JSON.stringify(status)}\n`);
}

export function markRunning(home: string, now: number): void {
  writeSyncStatus(home, {
    ...readSyncStatus(home),
    running: true,
    startedAt: Math.floor(now / 1000),
  });
}

/** One failed run is a blip; a day without a successful one is a problem. */
function failingTooLong(lastSuccessAt: string | undefined, now: number): boolean {
  return !lastSuccessAt || now - Date.parse(lastSuccessAt) > SILENT_FAILURE_MS;
}

export function noticeFor(
  outcome: RunOutcome,
  quarantined: number,
  lastSuccessAt: string | undefined,
  now: number
): string | null {
  if ("error" in outcome && failingTooLong(lastSuccessAt, now))
    return `failing: ${outcome.error.slice(0, MAX_ERROR_CHARS)} (pal cli sync)`;

  if (quarantined > 0)
    return `${quarantined} file(s) in quarantine (pal cli sync status)`;

  const refused = "result" in outcome ? outcome.result.refused.length : 0;

  return refused > 0 ? `${refused} refused (pal cli sync)` : null;
}

export function markFinished(home: string, now: number, outcome: RunOutcome): void {
  const before = readSyncStatus(home);
  const lastSuccessAt =
    "error" in outcome ? before.lastSuccessAt : new Date(now).toISOString();

  writeSyncStatus(home, {
    running: false,
    ...(lastSuccessAt && { lastSuccessAt }),
    notice: noticeFor(outcome, quarantineCount(home), before.lastSuccessAt, now),
  });
}
