/**
 * Append-only JSONL logger for Haiku token usage.
 * Writes to memory/signals/token-usage.jsonl
 */

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";

export type TokenCaller =
  | "rating"
  | "failure"
  | "work-learning"
  | "session-name"
  | "relationship";

interface TokenUsageEntry {
  ts: string;
  caller: TokenCaller;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function logTokenUsage(
  caller: TokenCaller,
  usage: { inputTokens: number; outputTokens: number },
  model?: string
): void {
  const entry: TokenUsageEntry = {
    ts: new Date().toISOString(),
    caller,
    model: model ?? DEFAULT_MODEL,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };

  const dir = ensureDir(paths.signals());
  const filepath = resolve(dir, "token-usage.jsonl");
  appendFileSync(filepath, JSON.stringify(entry) + "\n", "utf-8");
}
