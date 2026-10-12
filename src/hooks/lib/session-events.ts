/**
 * Session boundaries as events: when a session opened and why, when and why it
 * closed, and when its context was compacted.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent, eventsSince } from "./events";
import { type HookTurnPayload, hookSessionId } from "./hook-turn";
import { palPkg } from "./paths";

const START_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionStartPayload extends HookTurnPayload {
  source?: string;
}

interface SessionEndPayload extends HookTurnPayload {
  reason?: string;
}

interface CompactionPayload extends HookTurnPayload {
  trigger?: string;
  custom_instructions?: string;
}

function palVersion(): string | null {
  try {
    return JSON.parse(readFileSync(resolve(palPkg(), "package.json"), "utf-8")).version;
  } catch {
    return null;
  }
}

function timezone(now: Date) {
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffsetMin: 0 - now.getTimezoneOffset(),
  };
}

export function logSessionStart(
  payload: SessionStartPayload | null,
  now: Date = new Date()
): void {
  appendEvent(
    "session_start",
    { source: payload?.source ?? null, palVersion: palVersion(), ...timezone(now) },
    { ts: now.toISOString(), session: hookSessionId(payload) ?? null }
  );
}

function secondsSinceStart(session: string, now: Date): number | null {
  const since = new Date(now.getTime() - START_LOOKBACK_MS);
  const start = eventsSince("session_start", since).find((e) => e.session === session);
  if (!start) return null;
  return Math.round((now.getTime() - Date.parse(start.ts)) / 1000);
}

export function logSessionEnd(
  payload: SessionEndPayload | null,
  now: Date = new Date()
): void {
  const session = hookSessionId(payload) ?? null;
  appendEvent(
    "session_end",
    {
      reason: payload?.reason ?? null,
      durationSec: session ? secondsSinceStart(session, now) : null,
    },
    { ts: now.toISOString(), session }
  );
}

export function logCompaction(
  payload: CompactionPayload | null,
  now: Date = new Date()
): void {
  appendEvent(
    "compaction",
    {
      trigger: payload?.trigger ?? null,
      withInstructions: Boolean(payload?.custom_instructions?.trim()),
    },
    { ts: now.toISOString(), session: hookSessionId(payload) ?? null }
  );
}
