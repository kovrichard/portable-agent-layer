/**
 * Simple file-based debug logger for PAL hooks.
 * Writes to memory/state/debug.log — rotated on each session start.
 *
 * Only writes when debug is enabled (`pal cli debug on`) or when called via logError (always logged).
 */

import {
  appendFileSync,
  existsSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { palHome, paths } from "./paths";

const MAX_LOG_SIZE = 50_000; // ~50KB per file
const MAX_ROTATED = 5; // keep up to 5 rotated files (.1 newest → .5 oldest)

/** Resolved lazily so PAL_HOME overrides at runtime are honored. */
function logFile(): string {
  return resolve(paths.debug(), "debug.log");
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Rotate debug.log when it exceeds MAX_LOG_SIZE.
 *
 * Keeps up to MAX_ROTATED rotated files numbered .1 (newest) through
 * .MAX_ROTATED (oldest). Each rotation shifts .N-1 → .N, drops the oldest,
 * and renames the current log to .1. Total disk footprint bounded at
 * (MAX_ROTATED + 1) * MAX_LOG_SIZE ≈ 300KB.
 *
 * Migrates legacy .prev → .1 on first new rotation so existing history
 * survives the format change.
 */
function rotateIfNeeded(path: string): void {
  try {
    if (!existsSync(path) || statSync(path).size <= MAX_LOG_SIZE) return;
    // Backward-compat migration: legacy .prev was the single old rotation file.
    const legacyPrev = `${path}.prev`;
    if (existsSync(legacyPrev) && !existsSync(`${path}.1`)) {
      try {
        renameSync(legacyPrev, `${path}.1`);
      } catch {
        /* ignore */
      }
    }
    // Drop the oldest, then shift .N-1 → .N for N from MAX_ROTATED down to 2.
    const oldest = `${path}.${MAX_ROTATED}`;
    if (existsSync(oldest)) {
      try {
        unlinkSync(oldest);
      } catch {
        /* ignore */
      }
    }
    for (let i = MAX_ROTATED - 1; i >= 1; i--) {
      const src = `${path}.${i}`;
      const dst = `${path}.${i + 1}`;
      if (existsSync(src)) {
        try {
          renameSync(src, dst);
        } catch {
          /* ignore */
        }
      }
    }
    // Finally, current → .1
    renameSync(path, `${path}.1`);
  } catch {
    /* non-critical */
  }
}

/** Test-only: max rotated count for callers that need to enumerate. */
export const DEBUG_LOG_MAX_ROTATED = MAX_ROTATED;

function isDebugEnabled(): boolean {
  return existsSync(resolve(palHome(), "memory", "state", "debug-enabled"));
}

/** Log a debug message (only when debug is enabled via `pal cli debug on`) */
export function logDebug(source: string, message: string): void {
  if (!isDebugEnabled()) return;
  const path = logFile();
  rotateIfNeeded(path);
  try {
    appendFileSync(path, `[${timestamp()}] DEBUG ${source}: ${message}\n`);
  } catch {
    /* non-critical */
  }
}

/** Write last user prompt + retrieval injection to last-prompt.md (only when debug is enabled) */
export function logPromptSnapshot(prompt: string, retrieval: string | null): void {
  if (!isDebugEnabled()) return;
  const path = resolve(paths.debug(), "last-prompt.md");
  const content = retrieval
    ? `## Prompt\n\n${prompt}\n\n## Retrieval Injection\n\n${retrieval}`
    : `## Prompt\n\n${prompt}`;
  try {
    writeFileSync(path, content, "utf-8");
  } catch {
    /* non-critical */
  }
}

/** Write full context snapshot to context-snapshot.md (only when debug is enabled) */
export function logContextSnapshot(content: string): void {
  if (!isDebugEnabled()) return;
  const path = resolve(paths.debug(), "context-snapshot.md");
  try {
    writeFileSync(path, content, "utf-8");
  } catch {
    /* non-critical */
  }
}

/** Log an error (always written, regardless of debug mode) */
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
