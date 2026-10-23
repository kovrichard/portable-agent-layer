/**
 * The evidence PAL learns from: what the user typed, each turn joined with its
 * text and the reply it got. Only user-authority turns count. Forgetting never
 * deletes: it records an exclusion that can be undone, and the text stays.
 */

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  allEventsSince,
  appendEvent,
  contentDir,
  type EventType,
  eventsSince,
  type LoggedEvent,
  parseLines,
} from "./events";

type ContentRow = { id: string; ts: string; type: string } & Record<string, unknown>;

export interface EvidenceTurn {
  id: string;
  ts: string;
  session: string | null;
  runtime: string;
  channel: string | null;
  project: string | null;
  text: string | null;
  pastedChars: number | null;
  reply: { id: string; text: string | null } | null;
}

export interface Exclusion {
  id: string;
  since: string;
}

function contentFiles(): string[] {
  return readdirSync(contentDir())
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => resolve(contentDir(), f));
}

function contentById(): Map<string, ContentRow> {
  const rows = contentFiles().flatMap((f) => parseLines<ContentRow>(f));
  return new Map(rows.map((row) => [row.id, row]));
}

const textOf = (row: ContentRow | undefined, field: string): string | null =>
  typeof row?.[field] === "string" ? (row[field] as string) : null;

export function contentFor(id: string): ContentRow | null {
  return contentById().get(id) ?? null;
}

/** The latest forget or unforget of each id decides; the full history stays in the log. */
export function exclusions(): Exclusion[] {
  const latest = new Map<string, LoggedEvent>();
  for (const event of eventsSince("forgotten", new Date(0)))
    latest.set(String(event.target), event);
  return [...latest.entries()]
    .filter(([, event]) => event.undone !== true)
    .map(([id, event]) => ({ id, since: event.ts }));
}

function repliesByTurn(events: LoggedEvent[]): Map<unknown, LoggedEvent> {
  return new Map(ofType(events, "reply").map((e) => [e.turn, e]));
}

const ofType = (events: LoggedEvent[], type: EventType) =>
  events.filter((e) => e.type === type);

export function userTurnsSince(since: Date): EvidenceTurn[] {
  const events = allEventsSince(since);
  const content = contentById();
  const replies = repliesByTurn(events);
  const excluded = new Set(exclusions().map((e) => e.id));
  const textIfKept = (id: string, field: string) =>
    excluded.has(id) ? null : textOf(content.get(id), field);
  return ofType(events, "turn")
    .filter((e) => e.authority === "user" && !excluded.has(e.id))
    .map((turn) => {
      const reply = replies.get(turn.id);
      return {
        id: turn.id,
        ts: turn.ts,
        session: turn.session,
        runtime: turn.runtime,
        channel: turn.channel,
        project: turn.project,
        text: textIfKept(turn.id, "prompt"),
        pastedChars: typeof turn.pastedChars === "number" ? turn.pastedChars : null,
        reply: reply ? { id: reply.id, text: textIfKept(reply.id, "reply") } : null,
      };
    });
}

/** Keeps the event out of everything PAL learns from; its text is left as it was. */
export function forget(id: string): boolean {
  if (!contentFor(id)) return false;
  return appendEvent("forgotten", { target: id, undone: false }) !== null;
}

export function unforget(id: string): boolean {
  if (!exclusions().some((e) => e.id === id)) return false;
  return appendEvent("forgotten", { target: id, undone: true }) !== null;
}
