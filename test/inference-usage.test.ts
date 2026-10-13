import { describe, expect, test } from "bun:test";
import {
  anthropicUsage,
  antigravitySpawnUsage,
  claudeResult,
  codexSpawnUsage,
  copilotSpawnUsage,
  jsonLines,
  openAiUsage,
  opencodeSpawnUsage,
} from "../src/hooks/lib/inference-usage";

const lines = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n");

describe("a CLI's JSON lines", () => {
  test("a line that parses to a bare value is not an event", () => {
    expect(jsonLines(`null\n5\n"text"\n{"type":"a"}\nnot json`)).toEqual([{ type: "a" }]);
  });

  test("claude's result is the result event, not the first line", () => {
    expect(
      claudeResult(lines({ type: "system" }, { type: "result", result: "hi" }))
    ).toEqual({ type: "result", result: "hi" });
  });
});

describe("codex's usage", () => {
  test("every turn is summed, and a count one turn left out still sums the rest", () => {
    expect(
      codexSpawnUsage(
        lines(
          { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 1 } },
          { type: "turn.completed", usage: { input_tokens: 20, cached_input_tokens: 5 } },
          { type: "item.completed", usage: { input_tokens: 999 } },
          { type: "turn.completed" }
        )
      )
    ).toEqual({
      inputTokens: 25,
      outputTokens: 1,
      thinkingTokens: undefined,
      cacheWrite5m: undefined,
      cacheRead: 5,
    });
  });

  test("a turn with no input count leaves input unknown", () => {
    expect(
      codexSpawnUsage(lines({ type: "turn.completed", usage: { output_tokens: 3 } }))
        ?.inputTokens
    ).toBeUndefined();
  });

  test("no turn at all is no usage", () => {
    expect(codexSpawnUsage(lines({ type: "thread.started" }))).toBeUndefined();
  });
});

describe("opencode's usage", () => {
  test("only finished steps count, and a step without cache counts the rest", () => {
    expect(
      opencodeSpawnUsage(
        lines(
          { type: "step_start", part: { tokens: { input: 999 } } },
          { type: "step_finish", part: { tokens: { input: 4, output: 2 } } },
          { type: "step_finish", part: { tokens: null } }
        )
      )
    ).toEqual({
      inputTokens: 4,
      outputTokens: 2,
      thinkingTokens: undefined,
      cacheWrite5m: undefined,
      cacheRead: undefined,
      costUsd: undefined,
    });
  });

  test("no finished step is no usage", () => {
    expect(opencodeSpawnUsage(lines({ type: "text", part: {} }))).toBeUndefined();
    expect(
      opencodeSpawnUsage(lines({ type: "step_finish", part: { tokens: null } }))
    ).toBeUndefined();
  });
});

describe("copilot's and antigravity's usage", () => {
  test("a copilot checkpoint with no data, or no prompt count, reports nothing it lacks", () => {
    expect(
      copilotSpawnUsage(lines({ type: "session.usage_checkpoint" }))
    ).toBeUndefined();
    expect(
      copilotSpawnUsage(lines({ type: "session.usage_checkpoint", data: {} }))
    ).toBeUndefined();
    expect(
      copilotSpawnUsage(
        lines({
          type: "session.usage_checkpoint",
          data: { promptCacheBreakState: [{ models: { m: { cache_read: 2 } } }] },
        })
      )
    ).toEqual({ inputTokens: undefined, cacheWrite5m: undefined, cacheRead: 2 });
  });

  test("antigravity without a result event is no usage", () => {
    expect(antigravitySpawnUsage(lines({ event: "init" }))).toBeUndefined();
  });
});

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
