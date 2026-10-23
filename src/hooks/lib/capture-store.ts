/**
 * Which sessions have already been summarized, and at what length.
 *
 * A session's Stop event fires after every response, so the same session reaches
 * the capture handler many times. Without a record of what was already written,
 * each pass would append another near-identical project-history entry.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

export interface CaptureEntry {
  messageCount: number;
  userMessageCount?: number;
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
  if (typeof value === "string") return { messageCount: 0 };
  if (value && typeof value === "object") {
    const { messageCount, userMessageCount } = value as CaptureEntry;
    return {
      messageCount,
      ...(userMessageCount === undefined ? {} : { userMessageCount }),
    };
  }
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

/**
 * The handoff describes the latest turn, so any new message from the user makes
 * it stale, however little the transcript grew.
 */
export function isHandoffStale(
  previous: CaptureEntry | null,
  userMessageCount: number
): boolean {
  if (!previous) return true;
  return userMessageCount > (previous.userMessageCount ?? 0);
}

function updateCapture(sessionId: string, update: Partial<CaptureEntry>): void {
  const data = readAll();
  const current = data[sessionId] ?? { messageCount: 0 };
  data[sessionId] = { ...current, ...update };
  const entries = Object.entries(data);
  const kept = entries.length > MAX_REMEMBERED ? entries.slice(-MAX_REMEMBERED) : entries;
  writeFileSync(
    capturedPath(),
    JSON.stringify(Object.fromEntries(kept), null, 2),
    "utf-8"
  );
}

export function markCaptured(sessionId: string, messageCount: number): void {
  updateCapture(sessionId, { messageCount });
}

/** Claimed before the model call, so a second Stop for the same turn finds it taken. */
export function claimHandoffSummary(sessionId: string, userMessageCount: number): void {
  updateCapture(sessionId, { userMessageCount });
}
