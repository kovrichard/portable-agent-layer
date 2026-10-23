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

function contentFiles(fromMonth = ""): string[] {
  return readdirSync(contentDir())
    .filter((f) => f.endsWith(".jsonl") && f.slice(0, 7) >= fromMonth)
    .sort()
    .map((f) => resolve(contentDir(), f));
}

function contentById(fromMonth = ""): Map<string, ContentRow> {
  const rows = contentFiles(fromMonth).flatMap((f) => parseLines<ContentRow>(f));
  return new Map(rows.map((row) => [row.id, row]));
}

const textOf = (row: ContentRow | undefined, field: string): string | null =>
  typeof row?.[field] === "string" ? (row[field] as string) : null;

export function contentFor(id: string): ContentRow | null {
  return contentById().get(id) ?? null;
}

function forgottenIds(): Set<string> {
  return new Set(
    allEventsSince(new Date(0))
      .filter((e) => e.type === "forgotten")
      .map((e) => String(e.target))
  );
}

function repliesByTurn(events: LoggedEvent[]): Map<string, LoggedEvent> {
  return new Map(
    events
      .filter((e) => e.type === "reply" && typeof e.turn === "string")
      .map((e) => [e.turn as string, e])
  );
}

export function userTurnsSince(since: Date): EvidenceTurn[] {
  const events = allEventsSince(since);
  const content = contentById(since.toISOString().slice(0, 7));
  const replies = repliesByTurn(events);
  const forgotten = forgottenIds();
  return events
    .filter((e) => e.type === "turn" && e.authority === "user" && !forgotten.has(e.id))
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
          ? {
              id: reply.id,
              text: forgotten.has(reply.id)
                ? null
                : textOf(content.get(reply.id), "reply"),
            }
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
