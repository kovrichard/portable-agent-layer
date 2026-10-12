/**
 * Every rating in the signals file, as a rating event. The rated context and
 * the reply preview are text, so they go to the content store.
 */

import {
  logRatingEvent,
  type RatingSignal,
  ratingEventId,
  readRatings,
} from "../../../hooks/lib/signals";
import { emitUnseen, recordedAttribution } from "./rows";

function emitRating(row: RatingSignal): void {
  logRatingEvent(row, { cwd: "", attribution: recordedAttribution(row) });
}

/** Appends the ratings not yet logged and returns how many. */
export function backfillRatings(known: Set<string>, since?: string): number {
  return emitUnseen(readRatings(), ratingEventId, emitRating, known, since);
}
