/**
 * Lightweight Anthropic API wrapper used by session naming, failure capture, etc.
 */

import { HAIKU_MODEL } from "./models";

export function hasApiKey(): boolean {
  return !!process.env.PAL_ANTHROPIC_API_KEY;
}

interface InferenceOptions {
  system?: string;
  user: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  /** JSON schema for structured output — guarantees valid JSON matching the schema */
  jsonSchema?: Record<string, unknown>;
}

interface InferenceResult {
  success: boolean;
  output?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export async function inference(opts: InferenceOptions): Promise<InferenceResult> {
  const apiKey = process.env.PAL_ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false };

  const {
    system,
    user,
    model = HAIKU_MODEL,
    maxTokens = 200,
    timeout = 5000,
    jsonSchema,
  } = opts;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const body: Record<string, unknown> = {
      model,
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
      const { logError } = await import("./log");
      const errBody = await response.text().catch(() => "");
      logError("inference", `HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      return { success: false };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rawUsage = data?.usage as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    const usage =
      rawUsage?.input_tokens != null && rawUsage?.output_tokens != null
        ? { inputTokens: rawUsage.input_tokens, outputTokens: rawUsage.output_tokens }
        : undefined;

    const content = data?.content as Array<{ text?: string }> | undefined;
    const text = content?.[0]?.text?.trim();
    if (!text) return { success: false, usage };

    return { success: true, output: text, usage };
  } catch (err) {
    const { logError } = await import("./log");
    logError("inference", err);
    return { success: false };
  }
}
