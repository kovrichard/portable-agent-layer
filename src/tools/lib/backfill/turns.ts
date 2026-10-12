/**
 * Every turn measured before turns streamed into the event log. A row keeps
 * the machine, actor and runtime it was written with, since an imported file
 * holds other machines' rows too.
 */

import type { RecordAttribution } from "../../../hooks/lib/actor";
import { appendEvent } from "../../../hooks/lib/events";
import {
  legacyTurnId,
  legacyTurns,
  type TurnEvent,
} from "../../../hooks/lib/interaction";

type LegacyTurn = TurnEvent & Partial<RecordAttribution>;

function attributionOf({ machine, actor, runtime, authority }: LegacyTurn) {
  return Object.fromEntries(
    Object.entries({ machine, actor, runtime, authority }).filter(([, v]) => v)
  ) as Partial<RecordAttribution>;
}

function emitTurn(turn: LegacyTurn): void {
  const { ts, session, channel, ...fields } = turn;
  appendEvent("turn", fields, {
    id: legacyTurnId(turn),
    ts,
    session,
    channel: channel ?? null,
    cwd: "",
    attribution: attributionOf(turn),
  });
}

/** Appends the legacy turns not yet logged and returns how many. */
export function backfillTurns(known: Set<string>, since?: string): number {
  let emitted = 0;
  for (const turn of legacyTurns() as LegacyTurn[]) {
    const id = legacyTurnId(turn);
    if (known.has(id) || turn.ts < new Date(since ?? 0).toISOString()) continue;
    known.add(id);
    emitTurn(turn);
    emitted++;
  }
  return emitted;
}
