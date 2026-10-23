/**
 * The evidence PAL learns from: what the user typed, each turn joined with its
 * text and the reply it got. Only user-authority turns count, and a forgotten
 * turn is gone from every read.
 */

import { readdirSync, renameSync, writeFileSync } from "node:fs";
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

function forgottenIds(): Set<string> {
  return new Set(eventsSince("forgotten", new Date(0)).map((e) => String(e.target)));
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
  const forgotten = forgottenIds();
  return ofType(events, "turn")
    .filter((e) => e.authority === "user" && !forgotten.has(e.id))
    .map((turn) => {
      const reply = replies.get(turn.id);
      return {
        id: turn.id,
        ts: turn.ts,
        session: turn.session,
        runtime: turn.runtime,
        channel: turn.channel,
        project: turn.project,
        text: textOf(content.get(turn.id), "prompt"),
        pastedChars: typeof turn.pastedChars === "number" ? turn.pastedChars : null,
        reply: reply
          ? { id: reply.id, text: textOf(content.get(reply.id), "reply") }
          : null,
      };
    });
}

function redacted({ id, ts, type }: ContentRow): ContentRow {
  return { id, ts, type, forgotten: true };
}

function redactIn(file: string, id: string): boolean {
  const rows = parseLines<ContentRow>(file);
  if (!rows.some((row) => row.id === id)) return false;
  const kept = rows.map((row) => (row.id === id ? redacted(row) : row));
  writeFileSync(`${file}.tmp`, kept.map((row) => `${JSON.stringify(row)}\n`).join(""));
  renameSync(`${file}.tmp`, file);
  return true;
}

/** Records that the user took this back, and removes its text from the content store. */
export function forget(id: string): boolean {
  const found = contentFiles().some((file) => redactIn(file, id));
  if (found) appendEvent("forgotten", { target: id });
  return found;
}
