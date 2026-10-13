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
