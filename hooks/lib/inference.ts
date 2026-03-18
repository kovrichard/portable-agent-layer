/**
 * Lightweight Anthropic API wrapper used by session naming, failure capture, etc.
 */

export interface InferenceOptions {
  system?: string;
  user: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  /** JSON schema for structured output — guarantees valid JSON matching the schema */
  jsonSchema?: Record<string, unknown>;
}

export interface InferenceResult {
  success: boolean;
  output?: string;
}

export async function inference(opts: InferenceOptions): Promise<InferenceResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false };

  const {
    system,
    user,
    model = "claude-haiku-4-5-20251001",
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

    if (!response.ok) return { success: false };

    const data = (await response.json()) as Record<string, unknown>;
    const content = data?.content as Array<{ text?: string }> | undefined;
    const text = content?.[0]?.text?.trim();
    if (!text) return { success: false };

    return { success: true, output: text };
  } catch {
    return { success: false };
  }
}
