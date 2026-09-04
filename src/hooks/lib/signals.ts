import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentAttribution } from "./actor";
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
): void {
  const signal: Signal = { ts: now(), ...currentAttribution(), ...data };
  const filepath = resolve(paths.signals(), filename);
  appendFileSync(filepath, `${JSON.stringify(signal)}\n`);
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
  emitSignal("ratings.jsonl", data);
}
