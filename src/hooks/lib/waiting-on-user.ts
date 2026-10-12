/**
 * A marker per session for the moment the agent started waiting on the user,
 * taken by whatever the user does next so it can say how long they took.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";

const MAX_WAIT_SEC = 30 * 60;

type WaitKind = "permission" | "notified";

interface Waiting {
  ts: string;
  tool?: string;
}

function waitingFile(kind: WaitKind, session: string): string {
  const safe = session.replace(/[^\w-]/g, "_");
  return resolve(
    ensureDir(resolve(paths.state(), "waiting-on-user")),
    `${kind}-${safe}.json`
  );
}

export function markWaiting(kind: WaitKind, session: string, waiting: Waiting): void {
  writeFileSync(waitingFile(kind, session), JSON.stringify(waiting));
}

function readWaiting(file: string): Waiting | null {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function secondsSince(ts: string, now: Date): number {
  return Math.round((now.getTime() - Date.parse(ts)) / 100) / 10;
}

function takeWaiting(
  kind: WaitKind,
  session: string,
  now: Date,
  belongs: (waiting: Waiting) => boolean = () => true
): number | null {
  const file = waitingFile(kind, session);
  if (!existsSync(file)) return null;
  const waiting = readWaiting(file);
  if (waiting && !belongs(waiting)) return null;
  rmSync(file, { force: true });
  if (!waiting) return null;
  const waited = secondsSince(waiting.ts, now);
  return waited >= 0 && waited <= MAX_WAIT_SEC ? waited : null;
}

/** Seconds the user took to answer a prompt for this tool, once; null when none was open. */
export function permissionWaitSec(
  session: string | null,
  tool: string,
  now: Date = new Date()
): number | null {
  if (!session) return null;
  return takeWaiting("permission", session, now, (waiting) => waiting.tool === tool);
}

/** Seconds from the last notification to the user's next prompt, once. */
export function backAfterNotificationSec(
  session: string,
  now: Date = new Date()
): number | null {
  return takeWaiting("notified", session, now);
}
