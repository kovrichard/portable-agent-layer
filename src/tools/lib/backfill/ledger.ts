/**
 * Every ledger entry, as an action event: what an agent changed or was stopped
 * from changing. The target path, the reason and a refused command are text,
 * so they go to the content store.
 */

import { dirname, extname } from "node:path";
import { appendEvent } from "../../../hooks/lib/events";
import type { LedgerEntry } from "../../../hooks/lib/ledger";
import { changeShape, locate, readLedger } from "../../ledger/query";
import { emitUnseen, recordedAttribution } from "./rows";

const actionEventId = (entry: LedgerEntry) => `ledger:${entry.id}`;

function linesOf(entry: LedgerEntry) {
  const shape = changeShape(entry);
  if (shape.kind !== "hunks")
    return { change: shape.kind, linesAdded: null, linesRemoved: null };
  return {
    change: shape.kind,
    linesAdded: shape.delta.hunks.reduce((n, h) => n + h.insert.length, 0),
    linesRemoved: shape.delta.hunks.reduce((n, h) => n + h.remove, 0),
  };
}

function directoryOf(entry: LedgerEntry): string {
  const { path } = locate(entry);
  if (!path) return "";
  return entry.command === undefined ? dirname(path) : path;
}

function emitAction(entry: LedgerEntry, id: string): void {
  appendEvent(
    "action",
    {
      tool: entry.tool,
      outcome: entry.outcome,
      fileExt: entry.command === undefined ? extname(entry.target) || null : null,
      ...linesOf(entry),
      beforeBytes: entry.before?.bytes ?? null,
      afterBytes: entry.after?.bytes ?? null,
    },
    {
      id,
      ts: entry.ts,
      session: null,
      channel: null,
      cwd: directoryOf(entry),
      attribution: recordedAttribution(entry),
      content: {
        target: entry.target,
        reason: entry.reason ?? null,
        command: entry.command ?? null,
      },
    }
  );
}

/** Appends the ledger entries not yet logged and returns how many. */
export function backfillLedger(known: Set<string>, since?: string): number {
  return emitUnseen(readLedger(), actionEventId, emitAction, known, since);
}
