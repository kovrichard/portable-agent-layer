/**
 * Every session PAL still has a record of, as the session_end it would have
 * logged. A record is the session's last known state, so it carries no reason,
 * duration or turn count; its name, summary and handoff are text and go to the
 * content store.
 */

import { appendEvent, eventsSince } from "../../../hooks/lib/events";
import { readSessionHistory, type SessionRecord } from "../../../hooks/lib/work-tracking";

const sessionEventId = (sessionId: string) => `session:${sessionId}`;

function endedSessions(): Set<string> {
  return new Set(
    eventsSince("session_end", new Date(0)).flatMap((e) => (e.session ? [e.session] : []))
  );
}

function emitSession(record: SessionRecord): void {
  appendEvent(
    "session_end",
    {
      reason: "backfill",
      durationSec: null,
      turns: null,
      messages: record.messageCount,
      status: record.status,
    },
    {
      id: sessionEventId(record.sessionId),
      ts: record.ts,
      session: record.sessionId,
      runtime: "unknown",
      channel: null,
      cwd: record.cwd,
      content: {
        name: record.name,
        summary: record.summary,
        handoff: record.handoff,
        artifacts: record.artifacts,
      },
    }
  );
}

/** Appends the sessions with no session_end yet and returns how many. */
export function backfillSessions(since?: string): number {
  const ended = endedSessions();
  const fresh = readSessionHistory().filter(
    (record) =>
      !ended.has(record.sessionId) &&
      (!since || record.ts >= new Date(since).toISOString())
  );
  for (const record of fresh) emitSession(record);
  return fresh.length;
}
