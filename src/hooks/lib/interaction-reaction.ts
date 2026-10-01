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
  /^(?:go ahead|go|do it|proceed|continue|merge|push|ship|commit|build|start|fix (?:all|them|both)|approved|let'?s (?:see|do|go))\b/i;

const NEW_TOPIC_RE =
  /^(?:(?:ok(?:ay)?|btw|also),?\s+)?(?:new (?:\w+ ){0,2}(?:task|topic|question|thing)|(?:different|unrelated|separate|another) (?:task|topic|question|thing)|unrelated\b|switching (?:gears|topics?)|change of (?:topic|subject))/i;

const GO_AHEAD_MAX_WORDS = 6;
const BARE_OK_RE = /^(?:ok(?:ay)?|k)[,.!]?(?:\s+\S+){0,2}$/i;
const HEDGE_RE = /\b(?:but|however|though|except|instead)\b/i;
const REPEAT_SIMILARITY = 0.6;
const REPEAT_MIN_KEYWORDS = 5;

export function isCorrection(text: string): boolean {
  return CORRECTION_RE.test(text.trim());
}

export function isRepeat(text: string, previous: string | undefined): boolean {
  if (!previous || extractKeywords(text).size < REPEAT_MIN_KEYWORDS) return false;
  return similarity(text, previous) >= REPEAT_SIMILARITY;
}

function isShortGoAhead(sentence: string): boolean {
  return GO_AHEAD_RE.test(sentence) && sentence.split(/\s+/).length <= GO_AHEAD_MAX_WORDS;
}

function lastSentence(text: string): string {
  return (
    text
      .split(/[.!\n]\s*/)
      .filter(Boolean)
      .at(-1)
      ?.trim() ?? ""
  );
}

function isApproval(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes("?") || HEDGE_RE.test(trimmed.split(/[.!?\n]/)[0])) return false;
  if (APPROVAL_RE.test(trimmed) || BARE_OK_RE.test(trimmed)) return true;
  return isShortGoAhead(trimmed) || isShortGoAhead(lastSentence(trimmed));
}

/** Word overlap was measured against real messages and does not separate topics; only saying so does. */
function isNewTopic(text: string): boolean {
  return NEW_TOPIC_RE.test(text.trim());
}

export function reactionTo(text: string, context: ReplyContext): Reaction {
  if (isCorrection(text)) return "corrected";
  if (isRepeat(text, context.previousPrompt)) return "repeated";
  if (isApproval(text)) return "approved";
  if (isNewTopic(text)) return "new-topic";
  return "follow-up";
}

export function replyKeywords(reply: string): string[] {
  return [...extractKeywords(reply)];
}
