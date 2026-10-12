/**
 * Every ledger entry, as the action event it would have streamed. Rows the
 * test suite leaked into the real ledger before it was sandboxed are left out.
 */

import {
  actionEventId,
  type LedgerEntry,
  logActionEvent,
} from "../../../hooks/lib/ledger";
import { readLedger } from "../../ledger/query";
import { emitUnseen, recordedAttribution } from "./rows";

const SUITE_SANDBOXED_AT = "2026-09-23T14:35:01.000Z";

function leakedFromTestSuite(entry: LedgerEntry): boolean {
  return entry.command === "rm -rf /" && entry.ts < SUITE_SANDBOXED_AT;
}

function emitAction(entry: LedgerEntry): void {
  logActionEvent(entry, recordedAttribution(entry));
}

/** Appends the ledger entries not yet logged and returns how many. */
export function backfillLedger(known: Set<string>, since?: string): number {
  const entries = readLedger().filter((entry) => !leakedFromTestSuite(entry));
  return emitUnseen(entries, actionEventId, emitAction, known, since);
}
