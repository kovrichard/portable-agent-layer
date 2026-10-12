/**
 * One event per inference PAL makes for itself: who asked, which route and
 * model answered, how long it took and how it ended.
 */

import { appendEvent, logQuietly } from "./events";

interface InferenceCall {
  caller?: string;
  sessionId?: string;
  tier?: string;
  web?: boolean;
}

interface InferenceOutcome {
  success: boolean;
  output?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export const SCHEMA_MISMATCH = "the reply does not match the schema";
const NO_ROUTE = ["none", "disabled"];

function failureOf(outcome: InferenceOutcome, route: string): string | null {
  if (outcome.success) return null;
  if (NO_ROUTE.includes(route)) return "unavailable";
  if (outcome.error?.startsWith(SCHEMA_MISMATCH)) return "schema";
  if (outcome.output) return "unparsable";
  return outcome.error ? "error" : "no-reply";
}

export function logInferenceCall(
  call: InferenceCall,
  planned: { route: string; model: string | null },
  outcome: InferenceOutcome,
  latencyMs: number
): void {
  logQuietly("inference_call", () =>
    appendEvent(
      "inference_call",
      {
        caller: call.caller ?? "anonymous",
        route: planned.route,
        model: planned.model,
        tier: call.tier ?? "small",
        web: Boolean(call.web),
        latencyMs: Math.round(latencyMs),
        failure: failureOf(outcome, planned.route),
        inputTokens: outcome.usage?.inputTokens ?? null,
        outputTokens: outcome.usage?.outputTokens ?? null,
      },
      { session: call.sessionId ?? null }
    )
  );
}
