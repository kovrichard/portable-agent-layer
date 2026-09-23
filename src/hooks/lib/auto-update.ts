/**
 * The daily self-update: when it may run unattended, and what came of it.
 *
 * `pal cli update` still owns the pull and the reinstall — this module only
 * decides whether to start it and records the outcome, so the command shape
 * lives in exactly one place.
 *
 * The ledger in state/auto-update.json is deliberately not update-available.json:
 * that one is an hourly detection cache, this one is the record of what was
 * attempted. A skip is stamped separately from an attempt so that skipping today
 * never consumes today's attempt.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cachedStatus, getInstalledVersion, isRepoMode } from "../handlers/update-check";
import { logDebug, logError } from "./log";
import { assets, palPkg, paths } from "./paths";
import { raw as rawSettings } from "./settings";

export interface AutoUpdateLedger {
  attemptedAt?: string;
  finishedAt?: string;
  ok?: boolean;
  from?: string;
  to?: string;
  error?: string;
  skippedAt?: string;
  skipped?: string;
}

export interface AutoUpdateStatus {
  enabled: boolean;
  decided: boolean;
  current: string;
  latest: string | null;
  available: boolean;
  checkedAt: string | null;
  mode: "repo" | "package";
  last: AutoUpdateLedger | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RESCUE_AFTER_MS = 3 * DAY_MS;
const LOCK_STALE_MS = 30 * 60 * 1000;
const DIRTY_TREE = "uncommitted changes in the PAL repo";

/**
 * Ending a session to clear or resume it leaves the agent running, so an update
 * there would rewrite the config of a CLI the user is still sitting in front of.
 */
const KEEPS_THE_AGENT_RUNNING = ["clear", "resume"];

function ledgerPath(): string {
  return resolve(paths.state(), "auto-update.json");
}

function logPath(): string {
  return resolve(paths.state(), "auto-update.log");
}

function lockPath(): string {
  return resolve(paths.state(), "auto-update.lock");
}

export function readLedger(): AutoUpdateLedger | null {
  try {
    const fp = ledgerPath();
    if (!existsSync(fp)) return null;
    return JSON.parse(readFileSync(fp, "utf-8")) as AutoUpdateLedger;
  } catch {
    return null;
  }
}

function writeLedger(entry: AutoUpdateLedger): AutoUpdateLedger {
  try {
    writeFileSync(ledgerPath(), `${JSON.stringify(entry, null, 2)}\n`, "utf-8");
  } catch (err) {
    logError("auto-update:ledger", err);
  }
  return entry;
}

function isAutoUpdateEnabled(): boolean {
  return rawSettings().autoUpdate?.enabled === true;
}

export function autoUpdateStatus(): AutoUpdateStatus {
  const settings = rawSettings().autoUpdate ?? {};
  const cache = cachedStatus();
  return {
    enabled: settings.enabled === true,
    decided: settings.decided === true,
    current: cache?.current ?? getInstalledVersion(),
    latest: cache?.latest ?? null,
    available: cache?.available === true,
    checkedAt: cache?.checkedAt ?? null,
    mode: cache?.mode ?? (isRepoMode() ? "repo" : "package"),
    last: readLedger(),
  };
}

/**
 * A pull cannot fast-forward over uncommitted work, so an unattended update on a
 * dirty clone would fail every night. It waits instead, and says so.
 */
function hasUncommittedChanges(): boolean {
  if (!isRepoMode()) return false;
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: palPkg(),
    encoding: "utf-8",
    windowsHide: true,
  });
  if (status.status !== 0) return false;
  return (status.stdout ?? "").trim().length > 0;
}

function recordSkip(reason: string): void {
  writeLedger({ ...readLedger(), skippedAt: new Date().toISOString(), skipped: reason });
  logDebug("auto-update", `skipped: ${reason}`);
}

function attemptedWithin(ledger: AutoUpdateLedger | null, now: number): boolean {
  if (!ledger?.attemptedAt) return false;
  return now - new Date(ledger.attemptedAt).getTime() < DAY_MS;
}

/** The unattended gate: opted in, not already tried today, and safe to pull. */
export function shouldAutoUpdate(now: number = Date.now()): boolean {
  if (!isAutoUpdateEnabled()) return false;
  if (attemptedWithin(readLedger(), now)) return false;
  if (hasUncommittedChanges()) {
    recordSkip(DIRTY_TREE);
    return false;
  }
  return true;
}

function updateCommand(): string[] {
  return [resolve(palPkg(), "src", "cli", "index.ts"), "cli", "update"];
}

function heldRecently(): boolean {
  try {
    const held = JSON.parse(readFileSync(lockPath(), "utf-8")) as { at?: string };
    return (
      Boolean(held.at) && Date.now() - new Date(String(held.at)).getTime() < LOCK_STALE_MS
    );
  } catch {
    return false;
  }
}

/**
 * Two agents can close at the same moment, and two `git pull`s into one clone is
 * not a race worth having. An exclusive create is the whole mechanism; a lock
 * older than the longest plausible update is treated as abandoned.
 */
function takeLock(): boolean {
  const note = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  try {
    writeFileSync(lockPath(), note, { flag: "wx" });
    return true;
  } catch {
    if (heldRecently()) return false;
    writeFileSync(lockPath(), note, "utf-8");
    return true;
  }
}

function releaseLock(): void {
  try {
    rmSync(lockPath(), { force: true });
  } catch (err) {
    logError("auto-update:lock", err);
  }
}

export function endsTheSession(reason: string | undefined): boolean {
  return !reason || !KEEPS_THE_AGENT_RUNNING.includes(reason);
}

function updatingNotice(): string {
  const cache = cachedStatus();
  const versions =
    cache?.latest && cache.latest !== cache.current
      ? ` (${cache.current} → ${cache.latest})`
      : "";
  return `📦 Updating PAL in the background${versions} — nothing to wait for, it finishes on its own.`;
}

/**
 * What every agent's close hook calls. Returns the line a terminal should print,
 * or null when there is nothing a user would want to know. Comparing the skip
 * stamp across the gate is how a skip recorded just now is told apart from one
 * left over from yesterday.
 */
export function autoUpdateOnClose(reason?: string): string | null {
  if (!endsTheSession(reason)) return null;
  const skippedBefore = readLedger()?.skippedAt;
  if (!shouldAutoUpdate()) {
    const ledger = readLedger();
    const skippedNow = ledger?.skippedAt && ledger.skippedAt !== skippedBefore;
    return skippedNow ? `📦 PAL update waiting — ${ledger?.skipped}.` : null;
  }
  spawnAutoUpdate();
  return updatingNotice();
}

function closeHookIsNotDelivering(ledger: AutoUpdateLedger | null): boolean {
  if (!ledger?.attemptedAt) return true;
  return Date.now() - new Date(ledger.attemptedAt).getTime() > RESCUE_AFTER_MS;
}

/**
 * The second chance, not the usual path. A session that is killed, or an agent
 * whose close event never arrives, would otherwise leave an install pinned
 * forever on a statusline telling it to restart — and restarting would not help.
 * Two small file reads on a normal start; the rest is only reached when the
 * close hook has been silent for days.
 */
export function autoUpdateOnStart(): boolean {
  if (!isAutoUpdateEnabled()) return false;
  if (!closeHookIsNotDelivering(readLedger())) return false;
  if (!shouldAutoUpdate()) return false;
  spawnAutoUpdate();
  return true;
}

/**
 * Runs in the detached child, never in the hook that spawned it. The attempt is
 * stamped before the command starts so a run that dies mid-flight still counts
 * against today — a broken update retries tomorrow, not every session.
 */
export function runAutoUpdate(): AutoUpdateLedger {
  if (hasUncommittedChanges()) {
    recordSkip(DIRTY_TREE);
    return readLedger() ?? {};
  }
  if (!takeLock()) {
    logDebug("auto-update", "another update holds the lock");
    return readLedger() ?? {};
  }
  try {
    return update();
  } finally {
    releaseLock();
  }
}

function update(): AutoUpdateLedger {
  const from = getInstalledVersion();
  writeLedger({ attemptedAt: new Date().toISOString(), from });

  const run = spawnSync("bun", updateCommand(), {
    cwd: palPkg(),
    encoding: "utf-8",
    windowsHide: true,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  try {
    writeFileSync(logPath(), output, "utf-8");
  } catch (err) {
    logError("auto-update:log", err);
  }

  const ok = run.status === 0;
  logDebug("auto-update", `update exited ${run.status}`);
  return writeLedger({
    ...readLedger(),
    finishedAt: new Date().toISOString(),
    ok,
    from,
    to: getInstalledVersion(),
    error: ok ? undefined : (run.error?.message ?? `exit ${run.status}`),
  });
}

/** Hands the update to its own process, which outlives the session that closed. */
export function spawnAutoUpdate(): void {
  try {
    const child = spawn("bun", [resolve(assets.hooks(), "AutoUpdate.ts")], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    logDebug("auto-update", "detached update spawned");
  } catch (err) {
    logError("auto-update:spawn", err);
  }
}
