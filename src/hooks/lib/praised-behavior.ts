/**
 * What a praised reply did that is worth doing again. Praise is rare next to
 * correction, so each one is read for a repeatable behavior rather than counted:
 * praise of the output itself (a good quiz, a nice design) names nothing to
 * repeat and is stored as such, which is how the share of usable praise is measured.
 */

import type { DraftInput } from "./adaptation-rules";
import type { PraisedBehavior, TurnInput } from "./adaptation-turns";

const PRAISED_BEHAVIOR_SYSTEM = `The user praised an AI assistant's reply. Decide whether the praise points at a repeatable behavior: something the assistant did that it could do again in a different situation later.

Repeatable: how the reply reasoned, decided, checked, communicated, or worked. For example, it argued back with a reason, verified a claim before making it, made a correct assumption and acted on it, or kept the answer short.

Not repeatable: the quality or content of this one output, such as a quiz, a design, a text, or a result, when the user names or implies no behavior behind it.

When the praise names or implies a behavior, set repeatable to true. Set when to the situation where the behavior applies, as one condition sentence without "when" at the start, and steering to the instruction that keeps the behavior, imperative. At most 25 words each, general enough to apply beyond this conversation's topic.

Otherwise set repeatable to false, and when and steering to empty strings.

Set explicit to true when the user asks for the behavior to continue, such as "keep this up", "more of this", or "always do this". Otherwise false.`;

const PRAISED_BEHAVIOR_SCHEMA = {
  type: "object",
  properties: {
    repeatable: { type: "boolean" },
    when: { type: "string" },
    steering: { type: "string" },
    explicit: { type: "boolean" },
  },
  required: ["repeatable", "when", "steering", "explicit"],
  additionalProperties: false,
} as const;

const MESSAGE_MAX = 800;

function praisedBehaviorUser(replyEnd: string, message: string): string {
  return `The end of the assistant's reply:\n<reply_end>\n${replyEnd}\n</reply_end>\n\nThe user's praise:\n<message>\n${message.slice(0, MESSAGE_MAX)}\n</message>`;
}

export function praisedBehaviorRequest(
  replyEnd: string,
  message: string,
  sessionId?: string
) {
  return {
    system: PRAISED_BEHAVIOR_SYSTEM,
    user: praisedBehaviorUser(replyEnd, message),
    maxTokens: 200,
    timeout: 90_000,
    jsonSchema: PRAISED_BEHAVIOR_SCHEMA,
    caller: "praised-behavior",
    sessionId,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function namedBehavior(parsed: Record<string, unknown>): PraisedBehavior["behavior"] {
  const when = text(parsed.when);
  const steering = text(parsed.steering);
  return parsed.repeatable === true && when && steering ? { when, steering } : undefined;
}

export function parsePraisedBehavior(
  output: string | null | undefined
): PraisedBehavior | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const behavior = namedBehavior(parsed);
    const explicit = parsed.explicit === true;
    return behavior ? { behavior, explicit } : { explicit };
  } catch {
    return null;
  }
}

export function needsPraisedBehavior(turn: TurnInput | null): turn is TurnInput {
  return turn?.reaction === "praised";
}

export function withPraisedBehavior(
  turn: TurnInput,
  praise: PraisedBehavior | null
): TurnInput {
  return praise ? { ...turn, praisedBehavior: praise } : turn;
}

const EVIDENCE_CHARS = 200;

function praiseEvidence(praise: PraisedBehavior, message: string): string {
  const quoted = `"${message.slice(0, EVIDENCE_CHARS)}"`;
  return praise.explicit ? `Asked to keep it: ${quoted}` : `Praised: ${quoted}`;
}

/** One praise is enough to draft: it is too rare to wait for a second. */
export function reinforcementDraft(
  praise: PraisedBehavior | null,
  message: string
): DraftInput | null {
  if (!praise?.behavior) return null;
  return {
    ...praise.behavior,
    polarity: "reinforce",
    evidence: [praiseEvidence(praise, message)],
  };
}
