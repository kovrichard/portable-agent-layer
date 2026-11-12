/**
 * TypeSafe's System One API (https://docs.typesafe.ai/api/system-one.md): one POST with every question, retried on 429 and 529.
 */

import {
  type JudgeAdapter,
  type JudgeAnswers,
  type SystemOneAsk,
  SystemOneError,
} from "./judgment";
import { logError } from "./log";

export const TYPESAFE_DEFAULT_MODEL = "jev-1.14.0";
const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const RETRYABLE = new Set([429, 529]);
const RETRY_LIMIT = 4;

function retryDelayMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function inputTokensOf(body: unknown): number {
  const tokens = (body as { usage?: { input_tokens?: unknown } } | null)?.usage
    ?.input_tokens;

  return typeof tokens === "number" && Number.isFinite(tokens) ? tokens : 0;
}

async function postOnce(input: SystemOneAsk, body: string): Promise<Response> {
  try {
    return await input.http(TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: input.signal,
    });
  } catch (err) {
    logError("judge:typesafe", err);
    throw new SystemOneError(input.signal.aborted ? "timeout" : "http");
  }
}

async function readReply(
  response: Response
): Promise<{ answers: JudgeAnswers; inputTokens: number }> {
  const text = await response.text();

  if (!response.ok) {
    logError("judge:typesafe", `HTTP ${response.status}: ${text.slice(0, 200)}`);
    throw new SystemOneError("http");
  }
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SystemOneError("http", "reply is not JSON");
  }

  return {
    answers: (parsed as { answers: JudgeAnswers }).answers,
    inputTokens: inputTokensOf(parsed),
  };
}

async function askTypesafe(
  input: SystemOneAsk
): Promise<{ answers: JudgeAnswers; inputTokens: number }> {
  const body = JSON.stringify({
    model: input.model,
    state: input.state,
    questions: input.questions,
  });

  for (let attempt = 0; ; attempt++) {
    const response = await postOnce(input, body);
    if (!RETRYABLE.has(response.status)) return await readReply(response);

    if (attempt === RETRY_LIMIT) throw new SystemOneError("rate-limited");
    await input.sleep(retryDelayMs(attempt));

    if (input.signal.aborted) throw new SystemOneError("timeout");
  }
}

export const typesafeAdapter: JudgeAdapter = {
  defaultModel: TYPESAFE_DEFAULT_MODEL,
  keyNames: ["PAL_TYPESAFE_API_KEY", "TYPESAFE_API_KEY"],
  ask: askTypesafe,
};
