/**
 * Every rating in the signals file, as a rating event. The rated context and
 * the reply preview are text, so they go to the content store.
 */

import { appendEvent } from "../../../hooks/lib/events";
import { type RatingSignal, readRatings } from "../../../hooks/lib/signals";
import { type AttributedRow, emitUnseen, recordedAttribution } from "./rows";

type RatingRow = RatingSignal & AttributedRow;

const ratingEventId = (row: RatingRow) => `rating:${row.machine ?? "unknown"}:${row.ts}`;

function emitRating(row: RatingRow, id: string): void {
  appendEvent(
    "rating",
    { rating: row.rating, source: row.source },
    {
      id,
      ts: row.ts,
      session: null,
      channel: null,
      cwd: "",
      attribution: recordedAttribution(row),
      content: { context: row.context, responsePreview: row.response_preview ?? null },
    }
  );
}

/** Appends the ratings not yet logged and returns how many. */
export function backfillRatings(known: Set<string>, since?: string): number {
  return emitUnseen(
    readRatings() as RatingRow[],
    ratingEventId,
    emitRating,
    known,
    since
  );
}
