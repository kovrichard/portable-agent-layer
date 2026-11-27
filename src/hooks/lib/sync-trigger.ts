/**
 * Starts `pal cli sync` in a process of its own, so no agent waits on the
 * network: at session start and end always, after a turn at most every quarter
 * hour. Nothing runs on a machine where sync is not set up.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug, logError } from "../../core/log";
import { palHome, palPkg } from "../../core/paths";
import { readAccount } from "../../sync/account";
import { syncStateDir } from "../../sync/state";

const SYNC_INTERVAL_MS = 15 * 60_000;

export type SyncMoment = "start" | "turn" | "end";

export interface SyncTriggerDeps {
  home: string;
  now: number;
  start: (command: string[]) => void;
}

const stampFile = (home: string) => resolve(syncStateDir(home), "last-start");

function startDetached(command: string[]): void {
  spawn("bun", command, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

function turnSyncDue(home: string, now: number): boolean {
  if (!existsSync(stampFile(home))) return true;

  return now - Number(readFileSync(stampFile(home), "utf-8")) >= SYNC_INTERVAL_MS;
}

function markStarted(home: string, now: number): void {
  writeFileSync(stampFile(home), String(now));
}

/** True when a sync was started. */
export function startSyncIfDue(
  moment: SyncMoment,
  deps: Partial<SyncTriggerDeps> = {}
): boolean {
  const home = deps.home ?? palHome();
  const now = deps.now ?? Date.now();

  try {
    if (!readAccount(home)) return false;

    if (moment === "turn" && !turnSyncDue(home, now)) return false;
    markStarted(home, now);
    (deps.start ?? startDetached)([
      resolve(palPkg(), "src", "cli", "index.ts"),
      "cli",
      "sync",
    ]);
    logDebug("sync", `detached sync started at ${moment}`);

    return true;
  } catch (err) {
    logError("sync:start", err);

    return false;
  }
}
