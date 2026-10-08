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

const CORRECTION_CHECK_PROMPT = `An AI assistant sent a reply and the user answered. A first reader labelled the answer a correction of the reply. Check whether that is right.

It is a correction only when the user says or shows that the reply itself was wrong:
- something the reply claimed is false;
- something it said was done is not done;
- a command or step it gave does not work;
- a promise it made was not kept;
- following its advice or steps caused a problem;
- it missed what the user asked, or is waiting on or asking for something the user had already done;
- the user still does not understand after its explanation, even when they phrase it as a question.

It is not a correction when the user:
- wants more, or adds a requirement the reply was not asked to meet. "This needs more" or "it should also do X" is a new requirement unless the reply claimed X was already done;
- cannot find where or how to do a step the reply described;
- doubts the reply or asks for a check, without saying it is wrong;
- reports something that failed later, when the reply never claimed it would work;
- complains about something other than what the reply claimed;
- decides to change or drop a feature.`;

const CORRECTION_CHECK_ANSWER = `Answer corrected if it is a correction, otherwise not-corrected. For corrected, set issue to what the reply got wrong, in at most twelve words; otherwise set issue to an empty string.`;

const CORRECTION_CHECK_SCHEMA = {
  type: "object",
  properties: {
    reaction: { enum: ["corrected", "not-corrected"] },
    issue: { type: "string" },
  },
  required: ["reaction", "issue"],
  additionalProperties: false,
} as const;

const MESSAGE_MAX = 800;

function reactionPrompt(replyEnd: string, message: string): string {
  return `The end of the assistant's reply:\n<reply_end>\n${replyEnd}\n</reply_end>\n\nThe user's next message:\n<message>\n${message.slice(0, MESSAGE_MAX)}\n</message>`;
}

export function reactionRequest(replyEnd: string, message: string, sessionId?: string) {
  return {
    system: REACTION_SYSTEM_PROMPT,
    user: reactionPrompt(replyEnd, message),
    maxTokens: 200,
    timeout: 90_000,
    jsonSchema: REACTION_SCHEMA,
    caller: "rating",
    sessionId,
  };
}

/**
 * Asked again with the labelling prompt, a model repeats its own mistake; a
 * narrower question catches the follow-ups it misreads as corrections, and the
 * corrections it misreads as follow-ups. The answer instruction follows the
 * message, the order eval/correction-check measures.
 */
export function correctionCheckRequest(
  replyEnd: string,
  message: string,
  sessionId?: string
) {
  return {
    ...reactionRequest(replyEnd, message, sessionId),
    system: CORRECTION_CHECK_PROMPT,
    user: `${reactionPrompt(replyEnd, message)}\n\n${CORRECTION_CHECK_ANSWER}`,
    jsonSchema: CORRECTION_CHECK_SCHEMA,
  };
}

export function parseCorrectionCheck(
  output: string | null | undefined
): ReactionLabel | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as { reaction?: unknown; issue?: unknown };
    if (parsed.reaction !== "corrected") return { reaction: "follow-up", issue: "" };
    const issue = typeof parsed.issue === "string" ? parsed.issue.trim() : "";
    return { reaction: "corrected", issue };
  } catch {
    return null;
  }
}

export function needsCorrectionCheck(first: ReactionLabel | null): boolean {
  return isCorrectionLabel(first) || first?.reaction === "follow-up";
}

export function settledLabel(
  first: ReactionLabel | null,
  check: ReactionLabel | null
): ReactionLabel | null {
  const caughtFollowUp = first?.reaction === "follow-up" && isCorrectionLabel(check);
  return caughtFollowUp ? check : first;
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
