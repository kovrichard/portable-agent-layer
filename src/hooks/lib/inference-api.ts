import type { TranscriptUsage } from "../../tools/lib/transcript-usage";
import { type InferenceOptions, type InferenceResult, modelFor } from "./inference-types";
import { anthropicUsage, type OpenAiUsage, openAiUsage } from "./inference-usage";
import { logError } from "./log";
import { inferenceEffort } from "./models";
import { withPalEnv } from "./pal-env";

// ── Anthropic API path: no claude binary, or the active agent is not claude ──

export async function inferenceViaApi(opts: InferenceOptions): Promise<InferenceResult> {
  const apiKey = withPalEnv().PAL_ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false };

  const { system, user, maxTokens = 200, timeout = 5000, jsonSchema } = opts;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const body: Record<string, unknown> = {
      model: modelFor("anthropic-api", opts),
      max_tokens: maxTokens,
      messages: [{ role: "user", content: user }],
    };

    if (system) body.system = system;

    if (jsonSchema) {
      body.output_config = {
        format: { type: "json_schema", schema: jsonSchema },
      };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      logError("inference", `HTTP ${response.status}: ${errBody.slice(0, 200)}`);

      return { success: false };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const usage = data?.usage ? anthropicUsage(data.usage as TranscriptUsage) : undefined;

    const content = data?.content as Array<{ text?: string }> | undefined;
    const text = content?.[0]?.text?.trim();
    if (!text) return { success: false, usage };

    return { success: true, output: text, usage };
  } catch (err) {
    logError("inference", err);

    return { success: false };
  }
}

// ── OpenAI API path: codex users without a codex binary, who already hold an OpenAI key ──

export function buildOpenAiBody(opts: InferenceOptions): Record<string, unknown> {
  const { system, user, maxTokens = 500, jsonSchema } = opts;
  const messages: Array<{ role: string; content: string }> = [];

  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const body: Record<string, unknown> = {
    model: modelFor("openai-api", opts),
    max_tokens: maxTokens,
    messages,
  };
  const effort = inferenceEffort("openai-api", opts.tier);
  if (effort) body.reasoning_effort = effort;

  if (jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "structured_response", strict: true, schema: jsonSchema },
    };
  }

  return body;
}

export async function inferenceViaOpenAiApi(
  opts: InferenceOptions
): Promise<InferenceResult> {
  const apiKey = withPalEnv().PAL_OPENAI_API_KEY;
  if (!apiKey) return { success: false };

  const { timeout = 15000 } = opts;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const body = buildOpenAiBody(opts);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      logError("inference:openai", `HTTP ${response.status}: ${errBody.slice(0, 200)}`);

      return { success: false };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const usage = data?.usage ? openAiUsage(data.usage as OpenAiUsage) : undefined;

    const choices = data?.choices as
      | Array<{ message?: { content?: string } }>
      | undefined;
    const text = choices?.[0]?.message?.content?.trim();
    if (!text) return { success: false, usage };

    return { success: true, output: text, usage };
  } catch (err) {
    logError("inference:openai", err);

    return { success: false };
  }
}
