/**
 * Shadow signals that PAL itself may be broken, and their review. A judged
 * message keeps its text in the content store, so the verdicts can be labelled
 * before any of them is allowed to suggest a report.
 */

import { resolve } from "node:path";
import {
  appendEvent,
  contentDir,
  eventsSince,
  type LoggedEvent,
  logQuietly,
  parseLines,
} from "../bronze/events";
import { exclusions } from "../bronze/evidence";
import type { PalBugVerdict } from "./pal-bug";

export interface Signal {
  ts: string;
  trigger: string;
  surface: string;
  verdict: boolean | null;
  message: string | null;
}

export function recordMessageVerdict(
  message: string,
  verdict: PalBugVerdict | null,
  sessionId?: string
): void {
  logQuietly("pal_bug_signal", () =>
    appendEvent(
      "pal_bug_signal",
      {
        trigger: "message",
        surface: verdict?.surface ?? "",
        verdict: verdict ? verdict.palBug : null,
      },
      { content: { message }, session: sessionId ?? null }
    )
  );
}

type ContentRow = { id: string; message?: unknown };

/** Only the months that hold signals are read, and a forgotten message stays hidden. */
function messagesOf(events: LoggedEvent[]): Map<string, string> {
  const ids = new Set(events.map((event) => event.id));
  const hidden = new Set(exclusions().map((exclusion) => exclusion.id));
  const months = new Set(events.map((event) => event.ts.slice(0, 7)));
  const messages = new Map<string, string>();

  for (const month of months)
    for (const row of parseLines<ContentRow>(resolve(contentDir(), `${month}.jsonl`)))
      if (ids.has(row.id) && !hidden.has(row.id) && typeof row.message === "string")
        messages.set(row.id, row.message);

  return messages;
}

export function listSignals(since: Date): Signal[] {
  const events = eventsSince("pal_bug_signal", since);
  const messages = messagesOf(events);

  return events.map((event) => ({
    ts: event.ts,
    trigger: String(event.trigger),
    surface: String(event.surface ?? ""),
    verdict: typeof event.verdict === "boolean" ? event.verdict : null,
    message: messages.get(event.id) ?? null,
  }));
}
