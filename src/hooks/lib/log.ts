/**
 * Simple file-based debug logger for PAL hooks.
 * Writes to memory/state/debug.log — rotated on each session start.
 *
 * Only writes when PAL_DEBUG=1 or when called via logError (always logged).
 */

import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

const LOG_FILE = resolve(paths.state(), "debug.log");
const MAX_LOG_SIZE = 50_000; // ~50KB, then rotate

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function rotateIfNeeded(): void {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_SIZE) {
      const prev = `${LOG_FILE}.prev`;
      writeFileSync(prev, "");
      // Swap: current → prev, start fresh
      const { renameSync } = require("node:fs");
      renameSync(LOG_FILE, prev);
    }
  } catch {
    /* non-critical */
  }
}

/** Log a debug message (only when PAL_DEBUG=1) */
export function logDebug(source: string, message: string): void {
  if (process.env.PAL_DEBUG !== "1") return;
  rotateIfNeeded();
  try {
    appendFileSync(LOG_FILE, `[${timestamp()}] DEBUG ${source}: ${message}\n`);
  } catch {
    /* non-critical */
  }
}

/** Log an error (always written, regardless of PAL_DEBUG) */
export function logError(source: string, error: unknown): void {
  rotateIfNeeded();
  const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  try {
    appendFileSync(LOG_FILE, `[${timestamp()}] ERROR ${source}: ${msg}\n`);
  } catch {
    /* non-critical */
  }
}
