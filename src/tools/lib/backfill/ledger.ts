/**
 * Every ledger entry, as the action event it would have streamed.
 */

import {
  actionEventId,
  type LedgerEntry,
  logActionEvent,
} from "../../../hooks/lib/ledger";
import { readLedger } from "../../ledger/query";
import { emitUnseen, recordedAttribution } from "./rows";

function emitAction(entry: LedgerEntry): void {
  logActionEvent(entry, recordedAttribution(entry));
}

/** Appends the ledger entries not yet logged and returns how many. */
export function backfillLedger(known: Set<string>, since?: string): number {
  return emitUnseen(readLedger(), actionEventId, emitAction, known, since);
}
