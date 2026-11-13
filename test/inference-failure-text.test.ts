import { describe, expect, test } from "bun:test";
import { agentFailureText } from "../src/hooks/lib/inference-prompt";

const CLAUDE_ERROR_REPLY = JSON.stringify({
  duration_api_ms: 0,
  stop_reason: "stop_sequence",
  total_cost_usd: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
  is_error: true,
  result: "Invalid API key · Fix external API key",
});

describe("agentFailureText", () => {
  test("a JSON reply names its result, not the usage block before it", () => {
    expect(agentFailureText(CLAUDE_ERROR_REPLY)).toBe(
      "Invalid API key · Fix external API key"
    );
  });

  test("plain text comes back as it is", () => {
    expect(agentFailureText("Login expired.")).toBe("Login expired.");
  });

  test("JSON without a string result comes back as it is", () => {
    const reply = JSON.stringify({ is_error: true, usage: {} });
    expect(agentFailureText(reply)).toBe(reply);
  });

  test("an empty reply stays empty", () => {
    expect(agentFailureText("")).toBe("");
  });
});
