import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";
import { now } from "./time";

export interface Signal {
  ts: string;
  type: string;
  [key: string]: unknown;
}

/** Append a signal to a JSONL file in the signals directory */
export function emitSignal(
  filename: string,
  data: { type: string; [key: string]: unknown }
): void {
  const signal: Signal = { ts: now(), ...data };
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

/** Append a learning signal */
export function emitLearning(summary: string, category: string = "general"): void {
  emitSignal("learnings.jsonl", { type: "learning", summary, category });
}
