import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentAttribution, type RecordAttribution } from "./actor";
import { type AppendOptions, appendEvent } from "./events";
import { paths } from "./paths";
import { now } from "./time";

interface Signal {
  ts: string;
  type: string;
  [key: string]: unknown;
}

/** Append a signal to a JSONL file in the signals directory */
function emitSignal(
  filename: string,
  data: { type: string; [key: string]: unknown }
): Signal {
  const signal: Signal = { ts: now(), ...currentAttribution(), ...data };
  const filepath = resolve(paths.signals(), filename);
  appendFileSync(filepath, `${JSON.stringify(signal)}\n`);
  return signal;
}

export interface RatingSignal extends Signal, Partial<RecordAttribution> {
  rating: number;
  context: string;
  source: string;
  response_preview?: string;
}

export const ratingEventId = (row: RatingSignal) =>
  `rating:${row.machine ?? "unknown"}:${row.ts}`;

/** Logs a rating row as an event, under an id the row alone determines. */
export function logRatingEvent(
  row: RatingSignal,
  placement: Pick<AppendOptions, "attribution" | "cwd"> = {}
): string | null {
  return appendEvent(
    "rating",
    { rating: row.rating, source: row.source },
    {
      id: ratingEventId(row),
      ts: row.ts,
      session: null,
      channel: null,
      content: { context: row.context, responsePreview: row.response_preview ?? null },
      ...placement,
    }
  );
}

function parseSignal(line: string): RatingSignal[] {
  try {
    return [JSON.parse(line) as RatingSignal];
  } catch {
    return [];
  }
}

export function readRatings(): RatingSignal[] {
  const filepath = resolve(paths.signals(), "ratings.jsonl");
  if (!existsSync(filepath)) return [];
  return readFileSync(filepath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap(parseSignal)
    .filter((row) => row.type === "rating");
}

/** Append a rating signal */
export function emitRating(
  rating: number,
  context: string,
  source: string = "explicit",
  responsePreview?: string
): void {
  const data = {
    type: "rating",
    rating,
    context,
    source,
    ...(responsePreview ? { response_preview: responsePreview } : {}),
  };
  const signal = emitSignal("ratings.jsonl", data) as RatingSignal;
  logRatingEvent(signal);
}
