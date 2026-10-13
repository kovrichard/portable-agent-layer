/**
 * Append-only JSONL logger for Haiku token usage.
 * Writes to memory/signals/token-usage.jsonl
 */

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { InferenceUsage } from "./inference-usage";
import { HAIKU_MODEL } from "./models";
import { ensureDir, paths } from "./paths";

type TokenCaller =
  | "rating"
  | "rule-drafter"
  | "failure"
  | "session-name"
  | "session-intelligence"
  | "entity-extraction"
  | "entity-research"
  | "relationship"
  | "self-model"
  | "agenda-serves"
  | "agenda-goal-links"
  | "agenda-waiting-on"
  | "agenda-moves";

interface TokenUsageEntry {
  ts: string;
  caller: TokenCaller;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export function logTokenUsage(
  caller: TokenCaller,
  usage: InferenceUsage,
  model?: string
): void {
  const { inputTokens, outputTokens } = usage;
  if (inputTokens === undefined || outputTokens === undefined) return;
  const entry: TokenUsageEntry = {
    ts: new Date().toISOString(),
    caller,
    model: model ?? HAIKU_MODEL,
    inputTokens,
    outputTokens,
  };

  const dir = ensureDir(paths.signals());
  const filepath = resolve(dir, "token-usage.jsonl");
  appendFileSync(filepath, `${JSON.stringify(entry)}\n`, "utf-8");
}
