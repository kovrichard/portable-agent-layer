/**
 * What a low-rated session is asked about, and what is kept from the answer.
 *
 * The handler around this is spawned detached — claude --print's cold start
 * outruns the Stop hook's budget — so none of it was reachable from a test. The
 * decisions are here instead: how much of the transcript the question carries,
 * what the question is, and which of the two sources wins for each field.
 */

import { extractContent, parseMessages } from "./transcript";

/** Enough of the ending to see what went wrong, without paying for the whole session. */
const MAX_MESSAGES = 10;

/** Per message, so one long tool dump cannot crowd out the other nine. */
const MAX_CHARS_PER_MESSAGE = 300;

export interface PendingFailure {
  rating: number;
  context: string;
  detailedContext?: string;
  principle?: string;
  responsePreview?: string;
  userPreview?: string;
  cwd?: string;
}

export interface InferredPrinciple {
  principle?: string;
  detailedContext?: string;
}

export function recentExchange(transcript: string): string {
  return parseMessages(transcript)
    .slice(-MAX_MESSAGES)
    .map(
      (message) =>
        `${message.role.toUpperCase()}: ${extractContent(message).slice(0, MAX_CHARS_PER_MESSAGE)}`
    )
    .join("\n\n");
}

/** The parent may already have a principle, in which case there is nothing to ask. */
export function needsInference(pending: PendingFailure): boolean {
  return !pending.principle;
}

export function principleRequest(pending: PendingFailure, recent: string) {
  return {
    system: `Analyze this failed AI interaction (rated ${pending.rating}/10). Return JSON: {"principle": "<verb-first actionable rule, 10-20 words — write a full sentence, not a fragment>", "detailed_context": "<root cause and what to do differently, 50-150 words>"}.`,
    user: `User feedback: ${pending.context}\n\nConversation:\n${recent}`,
    maxTokens: 400,
    timeout: 90_000,
    jsonSchema: {
      type: "object" as const,
      properties: {
        principle: { type: "string" as const },
        detailed_context: { type: "string" as const },
      },
      required: ["principle", "detailed_context"],
      additionalProperties: false,
    },
    caller: "failure-principle",
  };
}

function parseInferred(output: string | null): InferredPrinciple {
  if (!output) return {};
  try {
    const parsed = JSON.parse(output) as {
      principle?: string;
      detailed_context?: string;
    };
    return {
      principle: parsed.principle || undefined,
      detailedContext: parsed.detailed_context || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The two fields resolve differently on purpose. A principle the parent already
 * had means inference never ran, so there is nothing to lose to; a detailed
 * context it already had was written from the full session and outranks one
 * inferred from ten messages.
 */
export function mergeInferredPrinciple(
  pending: PendingFailure,
  output: string | null
): InferredPrinciple {
  const inferred = parseInferred(output);
  return {
    principle: pending.principle || inferred.principle,
    detailedContext: pending.detailedContext ?? inferred.detailedContext,
  };
}
