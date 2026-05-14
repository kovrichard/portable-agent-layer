/**
 * Append-only JSONL logger for Haiku token usage.
 * Writes to memory/signals/token-usage.jsonl
 */

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { HAIKU_MODEL } from "./models";
import { ensureDir, paths } from "./paths";

export type TokenCaller =
  | "rating"
  | "failure"
  | "session-name"
  | "session-intelligence"
  | "relationship"
  | "self-model";

interface TokenUsageEntry {
  ts: string;
  caller: TokenCaller;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export function logTokenUsage(
  caller: TokenCaller,
  usage: { inputTokens: number; outputTokens: number },
  model?: string
): void {
  const entry: TokenUsageEntry = {
    ts: new Date().toISOString(),
    caller,
    model: model ?? HAIKU_MODEL,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };

  const dir = ensureDir(paths.signals());
  const filepath = resolve(dir, "token-usage.jsonl");
  appendFileSync(filepath, `${JSON.stringify(entry)}\n`, "utf-8");
}
