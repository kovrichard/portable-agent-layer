/**
 * How the user's message answers the agent's previous reply, read in code.
 * This is the outcome a reply is judged by, so precision beats recall:
 * anything unclear is a follow-up, never a guess at approval or complaint.
 */

import { extractKeywords, similarity } from "./text-similarity";

export type Reaction = "corrected" | "repeated" | "approved" | "new-topic" | "follow-up";

export interface ReplyContext {
  previousPrompt?: string;
  replyKeywords: string[];
}

const CORRECTION_RE =
  /^(?:(?:no|nope|wrong)(?:[,.!]|$)|(?:that'?s|this is|it'?s) (?:wrong|not)\b|not what i\b|i said\b|i told you\b|you forgot\b|you missed\b|still (?:broken|failing|wrong)\b)/i;

const APPROVAL_RE =
  /^(?:good|great|nice|perfect|cool|amazing|awesome|excellent|brilliant|works|it works|thanks|thank you|thx|y+e+s+|yep|yeah|yup|sure|exactly|correct|agreed|lgtm|well done|love it|sounds good|looks good|that'?s it|(?:it|this|that) (?:is|'s) (?:fine|good|great|right))\b/i;

const GO_AHEAD_RE =
  /^(?:go ahead|go|do it|proceed|continue|merge|push|ship|commit|build|approved|let'?s (?:see|do|go))\b/i;

const GO_AHEAD_MAX_WORDS = 6;
const BARE_OK_RE = /^(?:ok(?:ay)?|k)[,.!]?(?:\s+\S+){0,2}$/i;
const HEDGE_RE = /\b(?:but|however|though|except|instead)\b/i;
const REPEAT_SIMILARITY = 0.6;
const REPEAT_MIN_KEYWORDS = 5;
const NEW_TOPIC_MIN_KEYWORDS = 4;
const NEW_TOPIC_MAX_OVERLAP = 0.15;

export function isCorrection(text: string): boolean {
  return CORRECTION_RE.test(text.trim());
}

export function isRepeat(text: string, previous: string | undefined): boolean {
  if (!previous || extractKeywords(text).size < REPEAT_MIN_KEYWORDS) return false;
  return similarity(text, previous) >= REPEAT_SIMILARITY;
}

function isApproval(text: string): boolean {
  const trimmed = text.trim();
  if (HEDGE_RE.test(trimmed.split(/[.!?\n]/)[0])) return false;
  if (APPROVAL_RE.test(trimmed) || BARE_OK_RE.test(trimmed)) return true;
  return GO_AHEAD_RE.test(trimmed) && trimmed.split(/\s+/).length <= GO_AHEAD_MAX_WORDS;
}

/** Few of the message's words appear in the exchange it follows. */
function isNewTopic(text: string, context: ReplyContext): boolean {
  const words = extractKeywords(text);
  if (words.size < NEW_TOPIC_MIN_KEYWORDS) return false;
  const exchange = new Set([
    ...context.replyKeywords,
    ...extractKeywords(context.previousPrompt ?? ""),
  ]);
  const shared = [...words].filter((w) => exchange.has(w)).length;
  return shared / words.size <= NEW_TOPIC_MAX_OVERLAP;
}

export function reactionTo(text: string, context: ReplyContext): Reaction {
  if (isCorrection(text)) return "corrected";
  if (isRepeat(text, context.previousPrompt)) return "repeated";
  if (isApproval(text)) return "approved";
  if (isNewTopic(text, context)) return "new-topic";
  return "follow-up";
}

export function replyKeywords(reply: string): string[] {
  return [...extractKeywords(reply)];
}
