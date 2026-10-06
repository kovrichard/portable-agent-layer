/**
 * Implicit rating from the user's reaction to the previous reply.
 *
 * A model labels the reaction from the end of the reply and the message. Only a
 * correction, confirmed by a second call, or plain praise becomes a rating; a
 * go-ahead, a question or news carries no rating at all.
 */

import type { TurnInput } from "./adaptation-turns";

const MODEL_REACTIONS = [
  "corrected",
  "repeated",
  "praised",
  "approved",
  "new-topic",
  "follow-up",
] as const;

type ModelReaction = (typeof MODEL_REACTIONS)[number];

export interface ReactionLabel {
  reaction: ModelReaction;
  issue: string;
}

const REACTION_SYSTEM_PROMPT = `You classify how a user reacted to an AI assistant's reply.

Pick exactly one label:
- corrected: the message shows the reply itself was wrong. Something the reply claimed is false, something it said was done is missing, a command or step it gave does not work, a promise it made was not kept, it forgot or missed what the user asked, or the user still does not understand after its explanation.
- repeated: the user restates their previous request because it was not done.
- praised: the user explicitly praises the reply or the work, such as "well done", "perfect", "exactly", "this works great".
- approved: the user accepts the reply or tells the assistant to go ahead, with nothing else to fix.
- new-topic: the user moves to something unrelated to the reply.
- follow-up: anything else on the same work.

These are follow-up, not corrected:
- news about something that failed after the reply, when the reply never claimed it would work, such as a failed CI run or pasted errors;
- asking "are you sure?" or asking the assistant to double-check, without saying the reply is wrong;
- suggesting more, or a new requirement on top of the work;
- asking where or how to do a step the reply described;
- a complaint about something other than the reply.

A go-ahead, "yes", "ok", or "thanks" with a next instruction is approved, not praised.

Judge the message against what the reply said. Answer corrected only when the message clearly says or shows the reply was wrong; otherwise answer follow-up.

For corrected or repeated, set issue to what the reply got wrong, in at most twelve words. Otherwise set issue to an empty string.`;

const REACTION_SCHEMA = {
  type: "object",
  properties: {
    reaction: { enum: [...MODEL_REACTIONS] },
    issue: { type: "string" },
  },
  required: ["reaction", "issue"],
  additionalProperties: false,
} as const;

const MESSAGE_MAX = 800;

export function reactionRequest(replyEnd: string, message: string, sessionId?: string) {
  return {
    system: REACTION_SYSTEM_PROMPT,
    user: `The end of the assistant's reply:\n<reply_end>\n${replyEnd}\n</reply_end>\n\nThe user's next message:\n<message>\n${message.slice(0, MESSAGE_MAX)}\n</message>`,
    maxTokens: 200,
    timeout: 90_000,
    jsonSchema: REACTION_SCHEMA,
    caller: "rating",
    sessionId,
  };
}

function isModelReaction(value: unknown): value is ModelReaction {
  return MODEL_REACTIONS.includes(value as ModelReaction);
}

export function parseReactionLabel(
  output: string | null | undefined
): ReactionLabel | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as { reaction?: unknown; issue?: unknown };
    if (!isModelReaction(parsed.reaction)) return null;
    return {
      reaction: parsed.reaction,
      issue: typeof parsed.issue === "string" ? parsed.issue.trim() : "",
    };
  } catch {
    return null;
  }
}

export function isCorrectionLabel(label: ReactionLabel | null): boolean {
  return label?.reaction === "corrected" || label?.reaction === "repeated";
}

const RATING_BY_REACTION: Partial<Record<ModelReaction, number>> = {
  corrected: 3,
  repeated: 2,
  praised: 8,
};

/** A correction counts only when a second, independent label agrees. */
export function ratingFromLabels(
  first: ReactionLabel | null,
  confirmation: ReactionLabel | null
): number | null {
  if (!first) return null;
  if (isCorrectionLabel(first) && !isCorrectionLabel(confirmation)) return null;
  return RATING_BY_REACTION[first.reaction] ?? null;
}

interface SeenTurn {
  session: string;
  message: string;
  replyEnd: string;
}

export function turnFromLabels(
  seen: SeenTurn,
  first: ReactionLabel | null,
  confirmation: ReactionLabel | null
): TurnInput | null {
  if (!first) return null;
  const turn = { ...seen, reaction: first.reaction, issue: first.issue };
  return isCorrectionLabel(first)
    ? { ...turn, confirmed: isCorrectionLabel(confirmation) }
    : turn;
}

export function ratingContext(label: ReactionLabel, message: string): string {
  const what = label.reaction === "praised" ? "Praised the reply" : label.issue;
  return `${what || label.reaction}: ${message.slice(0, 200)}`;
}
