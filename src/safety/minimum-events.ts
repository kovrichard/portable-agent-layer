/**
 * Each step of a minimum run, as one `minimum_run` event: the start, every
 * round, every push-back with its lens, the floor, the cap and the end. The
 * goal, bar and round text go to the content store.
 */

import { appendEvent, logQuietly } from "../bronze/events";
import { minutesLeft, type Run } from "./run-mode";

export type MinimumChange =
  | "started"
  | "round"
  | "blocked"
  | "floor"
  | "capped"
  | "ended";

interface MinimumEventDetail {
  lens?: string | null;
  early?: boolean;
  content?: Record<string, unknown>;
}

function floorMinutes(run: Run): number {
  return Math.round((Date.parse(run.until) - Date.parse(run.startedAt)) / 60_000);
}

export function logMinimum(
  change: MinimumChange,
  run: Run,
  now: Date,
  detail: MinimumEventDetail = {}
): void {
  logQuietly("minimum_run", () =>
    appendEvent(
      "minimum_run",
      {
        change,
        lens: detail.lens ?? null,
        blocks: run.stopBlocks,
        rounds: run.rounds?.length ?? 0,
        floorMin: floorMinutes(run),
        minutesLeft: minutesLeft(run, now),
        bar: run.bar?.length ?? 0,
        ...(detail.early !== undefined && { early: detail.early }),
      },
      { ts: now.toISOString(), ...(detail.content && { content: detail.content }) }
    )
  );
}
