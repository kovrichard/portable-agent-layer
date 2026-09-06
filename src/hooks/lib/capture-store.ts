/**
 * Which sessions have already had their learning captured, and where the file went.
 *
 * A session's Stop event fires after every response, so the same session reaches
 * the capture handler many times. Without a record of what was already written,
 * each pass would produce another near-identical learning file for one session.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

export interface CaptureEntry {
  filepath: string;
  messageCount: number;
}

/** Below this many new messages, a re-capture would restate what was already written. */
const MIN_NEW_MESSAGES = 10;

/** How many sessions the file remembers before the oldest are dropped. */
const MAX_REMEMBERED = 50;

/** @lintignore exercised directly by test/capture-store.test.ts */
export function capturedPath(): string {
  return resolve(paths.state(), "captured-learnings.json");
}

/**
 * Entries were once a bare filepath string. One is read as a capture at message
 * zero, which makes any later session look new enough to re-capture — the safe
 * direction for a record whose message count was never written down.
 */
function asEntry(value: unknown): CaptureEntry | null {
  if (typeof value === "string") return { filepath: value, messageCount: 0 };
  if (value && typeof value === "object") return value as CaptureEntry;
  return null;
}

function readAll(): Record<string, CaptureEntry> {
  const path = capturedPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (Array.isArray(raw) || !raw || typeof raw !== "object") return {};
    const entries: Record<string, CaptureEntry> = {};
    for (const [id, value] of Object.entries(raw)) {
      const entry = asEntry(value);
      if (entry) entries[id] = entry;
    }
    return entries;
  } catch {
    return {};
  }
}

export function readCapture(sessionId: string): CaptureEntry | null {
  return readAll()[sessionId] ?? null;
}

/**
 * A session with no previous capture is always worth writing. One that has grown
 * by fewer than MIN_NEW_MESSAGES since is not: the transcript window the summary
 * is drawn from has barely moved, so the second file would say the same thing.
 */
export function isRecaptureWorthwhile(
  previous: CaptureEntry | null,
  messageCount: number
): boolean {
  if (!previous) return true;
  return messageCount - previous.messageCount >= MIN_NEW_MESSAGES;
}

export function markCaptured(
  sessionId: string,
  filepath: string,
  messageCount: number
): void {
  const data = readAll();
  data[sessionId] = { filepath, messageCount };
  const entries = Object.entries(data);
  const kept = entries.length > MAX_REMEMBERED ? entries.slice(-MAX_REMEMBERED) : entries;
  writeFileSync(
    capturedPath(),
    JSON.stringify(Object.fromEntries(kept), null, 2),
    "utf-8"
  );
}

/**
 * The readable half of a learning file's name. Four words, because the rest of
 * the name is already a timestamp and a category and the whole thing has to stay
 * a filename.
 */
export function learningSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-");
}
