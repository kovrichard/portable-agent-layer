/**
 * Session stop runs `pal cli events collect` at most every quarter hour, in its
 * own process, so a first backfill never holds up the agent that is closing.
 */

import { spawn, spawnSync } from "node:child_process";
import { statSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug, logError } from "../../core/log";
import { palPkg, paths } from "../../core/paths";
import { eventLogEnabled } from "../../core/settings";

const COLLECT_INTERVAL_MS = 15 * 60_000;

function lastCollectPath(): string {
  return resolve(paths.cache(), "collect-last-run");
}

export function collectDue(now: number = Date.now()): boolean {
  try {
    return now - statSync(lastCollectPath()).mtimeMs >= COLLECT_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function markCollected(now: number = Date.now()): void {
  writeFileSync(lastCollectPath(), "");
  utimesSync(lastCollectPath(), now / 1000, now / 1000);
}

function readsRealAgentDirs(): boolean {
  return !process.env.PAL_TEST_SANDBOX;
}

export const ANOTHER_COLLECT_RUNNING = 75;

function collectCommand(): string[] {
  return [resolve(palPkg(), "src", "cli", "index.ts"), "cli", "events", "collect"];
}

/**
 * Collects in a process of its own and waits for it, so a caller that must stay
 * synchronous gets the log caught up without holding the transcripts' reads in
 * its own memory. False when another collect held the lock.
 */
export function collectInChildProcess(): boolean {
  const done = spawnSync("bun", collectCommand(), { stdio: "ignore", windowsHide: true });

  return done.status !== ANOTHER_COLLECT_RUNNING;
}

export function spawnCollectIfDue(): void {
  if (!eventLogEnabled() || !readsRealAgentDirs() || !collectDue()) return;

  try {
    markCollected();
    spawn("bun", collectCommand(), {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    logDebug("collect", "detached collect spawned");
  } catch (err) {
    logError("collect:spawn", err);
  }
}
