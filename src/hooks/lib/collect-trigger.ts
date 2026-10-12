/**
 * Session stop runs `pal cli events collect` at most every quarter hour, in its
 * own process, so a first backfill never holds up the agent that is closing.
 */

import { spawn } from "node:child_process";
import { statSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug, logError } from "./log";
import { palPkg, paths } from "./paths";
import { eventLogEnabled } from "./settings";

const COLLECT_INTERVAL_MS = 15 * 60_000;

function lastCollectPath(): string {
  return resolve(paths.state(), "collect-last-run");
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

export function spawnCollectIfDue(): void {
  if (!eventLogEnabled() || !readsRealAgentDirs() || !collectDue()) return;
  try {
    markCollected();
    const cli = resolve(palPkg(), "src", "cli", "index.ts");
    spawn("bun", [cli, "cli", "events", "collect"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    logDebug("collect", "detached collect spawned");
  } catch (err) {
    logError("collect:spawn", err);
  }
}
