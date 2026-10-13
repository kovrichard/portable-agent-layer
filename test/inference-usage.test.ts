import { describe, expect, test } from "bun:test";
import { anthropicUsage, openAiUsage } from "../src/hooks/lib/inference-usage";

describe("an API route's usage, in model_call's fields", () => {
  test("Anthropic's cache writes split by TTL, with thinking and cost", () => {
    expect(
      anthropicUsage(
        {
          input_tokens: 9,
          output_tokens: 51,
          cache_read_input_tokens: 4,
          cache_creation_input_tokens: 6576,
          cache_creation: {
            ephemeral_5m_input_tokens: 0,
            ephemeral_1h_input_tokens: 6576,
          },
          output_tokens_details: { thinking_tokens: 32 },
        },
        0.013416
      )
    ).toEqual({
      inputTokens: 9,
      outputTokens: 51,
      cacheWrite5m: 0,
      cacheWrite1h: 6576,
      cacheRead: 4,
      thinkingTokens: 32,
      costUsd: 0.013416,
    });
  });

  test("OpenAI's cached tokens come out of the prompt count", () => {
    expect(
      openAiUsage({
        prompt_tokens: 1000,
        completion_tokens: 80,
        prompt_tokens_details: { cached_tokens: 600 },
        completion_tokens_details: { reasoning_tokens: 30 },
      })
    ).toEqual({ inputTokens: 400, outputTokens: 80, cacheRead: 600, thinkingTokens: 30 });
  });

  test("a count OpenAI leaves out stays unknown", () => {
    expect(openAiUsage({ completion_tokens: 5 })).toEqual({
      inputTokens: undefined,
      outputTokens: 5,
      cacheRead: undefined,
      thinkingTokens: undefined,
    });
  });
});
