/**
 * Every turn measured before turns streamed into the event log. A row keeps
 * the machine, actor and runtime it was written with, since an imported file
 * holds other machines' rows too.
 */

import { appendEvent } from "../../../hooks/lib/events";
import {
  legacyTurnId,
  legacyTurns,
  type TurnEvent,
} from "../../../hooks/lib/interaction";
import { type AttributedRow, emitUnseen, recordedAttribution } from "./rows";

type LegacyTurn = TurnEvent & AttributedRow;

function emitTurn(turn: LegacyTurn, id: string): void {
  const { ts, session, channel, ...fields } = turn;
  appendEvent("turn", fields, {
    id,
    ts,
    session,
    channel: channel ?? null,
    cwd: "",
    attribution: recordedAttribution(turn),
  });
}

/** Appends the legacy turns not yet logged and returns how many. */
export function backfillTurns(known: Set<string>, since?: string): number {
  return emitUnseen(legacyTurns() as LegacyTurn[], legacyTurnId, emitTurn, known, since);
}
