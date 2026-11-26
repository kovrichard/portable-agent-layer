import { spawn } from "node:child_process";
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug, logError } from "../core/log";
import { assets, paths } from "../core/paths";

export interface HealthSummary {
  checkedAt: string;
  failing: number;
  warnings: number;
  worst: string | null;
  notice: string | null;
}

const MINUTE_MS = 60_000;
const STALE_AFTER_MS = 6 * 60 * MINUTE_MS;
const MARKER_ABANDONED_AFTER_MS = 10 * MINUTE_MS;

export function healthFile(): string {
  return resolve(paths.cache(), "health.json");
}

export function healthMarkerFile(): string {
  return resolve(paths.cache(), "health-check.running");
}

export function writeHealthSummary(summary: HealthSummary): void {
  const file = healthFile();
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, `${JSON.stringify(summary)}\n`, "utf-8");
  renameSync(partial, file);
}

function checkedAt(): number {
  try {
    return Date.parse(JSON.parse(readFileSync(healthFile(), "utf-8")).checkedAt);
  } catch {
    return Number.NaN;
  }
}

/** The doctor's standing notice, or null when there is none or the cache is unreadable. */
export function readHealthNotice(): string | null {
  try {
    const { notice } = JSON.parse(readFileSync(healthFile(), "utf-8"));

    return typeof notice === "string" && notice !== "" ? notice : null;
  } catch {
    return null;
  }
}

export function isHealthStale(now: number): boolean {
  return !(now - checkedAt() <= STALE_AFTER_MS);
}

function markerIsLive(now: number): boolean {
  return now - statSync(healthMarkerFile()).mtimeMs < MARKER_ABANDONED_AFTER_MS;
}

function claimMarker(now: number): boolean {
  try {
    writeFileSync(healthMarkerFile(), `${process.pid}\n`, { flag: "wx" });

    return true;
  } catch {
    if (markerIsLive(now)) return false;
    writeFileSync(healthMarkerFile(), `${process.pid}\n`, "utf-8");

    return true;
  }
}

export function releaseHealthMarker(): void {
  try {
    rmSync(healthMarkerFile(), { force: true });
  } catch (err) {
    logError("health-check:marker", err);
  }
}

function spawnBackgroundDoctor(): void {
  const child = spawn("bun", [resolve(assets.hooks(), "HealthCheck.ts")], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

export function refreshHealthOnStart(
  spawnDoctor: () => void = spawnBackgroundDoctor,
  now: number = Date.now()
): void {
  if (process.env.PAL_SKIP_DOCTOR === "1") return;

  try {
    if (!isHealthStale(now) || !claimMarker(now)) return;
    spawnDoctor();
    logDebug("health-check", "detached doctor spawned");
  } catch (err) {
    releaseHealthMarker();
    logError("health-check:spawn", err);
  }
}
