/**
 * What one inference cost, in the token fields model_call uses, read from each
 * route's own usage report. A field the route does not report stays undefined.
 */

import { cacheWritesOf, type TranscriptUsage } from "../../tools/lib/transcript-usage";

export interface InferenceUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  cacheRead?: number;
  thinkingTokens?: number;
  costUsd?: number;
}

export const USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheWrite5m",
  "cacheWrite1h",
  "cacheRead",
  "thinkingTokens",
  "costUsd",
] as const satisfies readonly (keyof InferenceUsage)[];

export function jsonLines(raw: string): Record<string, unknown>[] {
  return raw.split("\n").flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

const sum = (values: (number | undefined)[]) =>
  values.some((v) => v !== undefined)
    ? values.reduce<number>((total, v) => total + (v ?? 0), 0)
    : undefined;

export function anthropicUsage(usage: TranscriptUsage, costUsd?: number): InferenceUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    ...cacheWritesOf(usage),
    cacheRead: usage.cache_read_input_tokens,
    thinkingTokens: usage.output_tokens_details?.thinking_tokens,
    costUsd,
  };
}

export interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

/** OpenAI counts cached tokens inside prompt_tokens. */
export function openAiUsage(usage: OpenAiUsage): InferenceUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens;
  return {
    inputTokens:
      usage.prompt_tokens === undefined
        ? undefined
        : usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    cacheRead,
    thinkingTokens: usage.completion_tokens_details?.reasoning_tokens,
  };
}

export function claudeResult(raw: string): Record<string, unknown> | undefined {
  return jsonLines(raw).find((event) => event.type === "result");
}

export function claudeSpawnUsage(raw: string): InferenceUsage | undefined {
  const result = claudeResult(raw);
  if (!result?.usage) return undefined;
  return anthropicUsage(result.usage as TranscriptUsage, result.total_cost_usd as number);
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

/** Codex counts cache reads and writes inside input_tokens. */
export function codexSpawnUsage(raw: string): InferenceUsage | undefined {
  const turns = jsonLines(raw)
    .filter((event) => event.type === "turn.completed" && event.usage)
    .map((event) => event.usage as CodexUsage);
  if (turns.length === 0) return undefined;
  const cacheRead = sum(turns.map((u) => u.cached_input_tokens));
  const cacheWrite = sum(turns.map((u) => u.cache_write_input_tokens));
  const input = sum(turns.map((u) => u.input_tokens));
  return {
    inputTokens:
      input === undefined ? undefined : input - (cacheRead ?? 0) - (cacheWrite ?? 0),
    outputTokens: sum(turns.map((u) => u.output_tokens)),
    thinkingTokens: sum(turns.map((u) => u.reasoning_output_tokens)),
    cacheWrite5m: cacheWrite,
    cacheRead,
  };
}

interface OpencodeStep {
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  } | null;
  cost?: number | null;
}

/** opencode reports reasoning apart from output; model_call counts it in both. */
export function opencodeSpawnUsage(raw: string): InferenceUsage | undefined {
  const steps = jsonLines(raw)
    .filter((event) => event.type === "step_finish")
    .map((event) => (event.part ?? {}) as OpencodeStep)
    .filter((step) => step.tokens);
  if (steps.length === 0) return undefined;
  const output = sum(steps.map((s) => s.tokens?.output));
  const reasoning = sum(steps.map((s) => s.tokens?.reasoning));
  return {
    inputTokens: sum(steps.map((s) => s.tokens?.input)),
    outputTokens: sum([output, reasoning]),
    thinkingTokens: reasoning,
    cacheWrite5m: sum(steps.map((s) => s.tokens?.cache?.write)),
    cacheRead: sum(steps.map((s) => s.tokens?.cache?.read)),
    costUsd: sum(steps.map((s) => s.cost ?? undefined)),
  };
}

interface AntigravityUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
}

export function antigravitySpawnUsage(raw: string): InferenceUsage | undefined {
  const result = jsonLines(raw).find((event) => event.event === "result")?.result as
    | { usage?: AntigravityUsage }
    | undefined;
  const usage = result?.usage;
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    thinkingTokens: usage.thinking_tokens,
    cacheRead: usage.cache_read_tokens,
  };
}
