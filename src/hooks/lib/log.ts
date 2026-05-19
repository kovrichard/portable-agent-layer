/**
 * Simple file-based debug logger for PAL hooks.
 * Writes to memory/state/debug.log — rotated on each session start.
 *
 * Only writes when PAL_DEBUG=1 or when called via logError (always logged).
 */

import { appendFileSync, existsSync, renameSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

const MAX_LOG_SIZE = 50_000; // ~50KB, then rotate

/** Resolved lazily so PAL_HOME overrides at runtime are honored. */
function logFile(): string {
  return resolve(paths.state(), "debug.log");
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function rotateIfNeeded(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size > MAX_LOG_SIZE) {
      const prev = `${path}.prev`;
      writeFileSync(prev, "");
      renameSync(path, prev);
    }
  } catch {
    /* non-critical */
  }
}

/** Log a debug message (only when PAL_DEBUG=1) */
export function logDebug(source: string, message: string): void {
  if (process.env.PAL_DEBUG !== "1") return;
  const path = logFile();
  rotateIfNeeded(path);
  try {
    appendFileSync(path, `[${timestamp()}] DEBUG ${source}: ${message}\n`);
  } catch {
    /* non-critical */
  }
}

/** Log an error (always written, regardless of PAL_DEBUG) */
export function logError(source: string, error: unknown): void {
  const path = logFile();
  rotateIfNeeded(path);
  const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  try {
    appendFileSync(path, `[${timestamp()}] ERROR ${source}: ${msg}\n`);
  } catch {
    /* non-critical */
  }
}
