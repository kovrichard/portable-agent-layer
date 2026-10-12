/**
 * Every agent's own records, read into the event log. A collector that fails
 * is logged and skipped; the others still run. One collect at a time: two
 * would read from the same cursors and emit the same events twice.
 */

import { rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { markCollected } from "../../../hooks/lib/collect-trigger";
import { logError } from "../../../hooks/lib/log";
import { paths, platform } from "../../../hooks/lib/paths";
import { eventLogEnabled } from "../../../hooks/lib/settings";
import { opencodeDatabase } from "../agent-usage";
import { antigravityDatabase, collectAntigravity } from "./antigravity";
import { claudeBilling, claudeConfigFile } from "./billing";
import { collectClaude } from "./claude";
import { collectCodex } from "./codex";
import { collectCopilot, copilotDatabase } from "./copilot";
import { collectOpencode } from "./opencode";

const LOCK_STALE_MS = 10 * 60_000;

const COLLECTORS: Record<string, () => number> = {
  claude: () =>
    collectClaude(
      resolve(platform.claudeDir(), "projects"),
      new Date(),
      claudeBilling(claudeConfigFile())
    ),
  opencode: () => collectOpencode(opencodeDatabase()),
  codex: () => collectCodex(platform.codexDir()),
  copilot: () => collectCopilot(copilotDatabase(platform.copilotDir())),
  antigravity: () =>
    collectAntigravity(antigravityDatabase(platform.antigravityCliDir())),
};

function lockPath(): string {
  return resolve(paths.state(), "collect.lock");
}

function lockIsFresh(now: number): boolean {
  try {
    return now - statSync(lockPath()).mtimeMs < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function takeLock(now: number): boolean {
  try {
    writeFileSync(lockPath(), String(process.pid), { flag: "wx" });
    return true;
  } catch {
    if (lockIsFresh(now)) return false;
    writeFileSync(lockPath(), String(process.pid));
    return true;
  }
}

function runCollectors(): Record<string, number | "failed"> {
  const emitted: Record<string, number | "failed"> = {};
  for (const [source, collect] of Object.entries(COLLECTORS)) {
    try {
      emitted[source] = collect();
    } catch (err) {
      logError(`collect:${source}`, err);
      emitted[source] = "failed";
    }
  }
  return emitted;
}

/** Null while another collect holds the lock. */
export function collectEvents(
  now: number = Date.now()
): Record<string, number | "failed"> | null {
  if (!eventLogEnabled()) return {};
  if (!takeLock(now)) return null;
  try {
    markCollected(now);
    return runCollectors();
  } finally {
    rmSync(lockPath(), { force: true });
  }
}
