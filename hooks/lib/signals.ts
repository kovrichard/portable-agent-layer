import { appendFileSync } from "fs";
import { resolve } from "path";
import { paths } from "./paths";
import { now } from "./time";

export interface Signal {
  ts: string;
  type: string;
  [key: string]: unknown;
}

/** Append a signal to a JSONL file in the signals directory */
export function emitSignal(filename: string, data: Omit<Signal, "ts">): void {
  const signal: Signal = { ts: now(), ...data };
  const filepath = resolve(paths.signals(), filename);
  appendFileSync(filepath, JSON.stringify(signal) + "\n");
}

/** Append a rating signal */
export function emitRating(rating: number, context: string, source: string = "explicit"): void {
  emitSignal("ratings.jsonl", { type: "rating", rating, context, source });
}

/** Append a learning signal */
export function emitLearning(summary: string, category: string = "general"): void {
  emitSignal("learnings.jsonl", { type: "learning", summary, category });
}
