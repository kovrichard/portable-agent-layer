/**
 * How the user's message answers the agent's previous reply, read in code.
 * This is the outcome a reply is judged by, so precision beats recall:
 * anything unclear is a follow-up, never a guess at approval or complaint.
 */

import { extractKeywords, similarity } from "./text-similarity";

export type Reaction =
  | "corrected"
  | "repeated"
  | "approved"
  | "go-ahead"
  | "new-topic"
  | "follow-up";

/** Logged with each reaction, so a log read under older rules is not read with today's meaning. */
export const REACTION_RULES = 2;
const GO_AHEAD_SPLIT = 2;

export function approvalIsKnown(turn: { reactionRules?: number }): boolean {
  return (turn.reactionRules ?? 1) >= GO_AHEAD_SPLIT;
}

const CORRECTION_RE =
  /^(?:(?:no|nope|wrong)(?:[,.!]|$)|(?:that'?s|this is|it'?s) (?:wrong|not)\b|not what i\b|i said\b|i told you\b|you forgot\b|you missed\b|still (?:broken|failing|wrong)\b|i don'?t see (?:the|your) (?!(?:problem|issue|point|harm|difference|need|reason)\b))/i;

const CLAIM_DISPUTED_RE =
  /\byou(?:'re| are) (?:partially |partly |completely |totally )?wrong\b|\b(?:isn'?t|wasn'?t|aren'?t|weren'?t) (?:added|included|fixed|pushed|committed|applied|merged)\b/i;

const APPROVAL_RE =
  /^(?:(?:understood|got it|ok(?:ay)?),?\s+)?(?:good|great|nice|perfect|cool|amazing|awesome|excellent|brilliant|works|it works|thanks|thank you|thx|y+e+s+|yep|yeah|yup|sure|exactly|correct|agreed|lgtm|well done|love it|sounds good|looks good|that'?s it|(?:it|this|that)(?: is|'s) (?:fine|good|great|right))\b/i;

const PRAISE_RE =
  /\b(?:good|great|nice|perfect|cool|amazing|awesome|excellent|brilliant|works|thanks|thank you|thx|exactly|correct|agreed|lgtm|well done|good job|love it|sounds good|looks (?:good|right)|that'?s it|(?:it|this|that)(?: is|'s) (?:fine|good|great|right))\b/i;

const GO_AHEAD_RE =
  /^(?:go ahead|go|do it|proceed|continue|merge|push|ship|commit|build|start|fix (?:all|them|both)|approved|let'?s (?:see|do|go|build|start|fix|ship)|(?:add|do|fix) (?:it )?(?:pls|please))\b/i;

const NEW_TOPIC_RE =
  /^(?:(?:ok(?:ay)?|btw|also),?\s+)?(?:new (?:\w+ ){0,2}(?:task|topic|question|thing)|(?:different|unrelated|separate|another) (?:task|topic|question|thing)|unrelated\b|switching (?:gears|topics?)|change of (?:topic|subject))/i;

const GO_AHEAD_MAX_WORDS = 6;
const BARE_OK_RE = /^(?:ok(?:ay)?|k)[,.!]?(?:\s+\S+){0,2}$/i;
const HEDGE_RE = /\b(?:but|however|though|except|instead)\b/i;
const FAILURE_RE = /\b(?:fail(?:ed|s|ing)?|broken|broke|errors?|crash(?:ed|es)?)\b/i;
const REPEAT_SIMILARITY = 0.6;
const REPEAT_MIN_KEYWORDS = 5;

export function isCorrection(text: string): boolean {
  const trimmed = text.trim();
  return CORRECTION_RE.test(trimmed) || CLAIM_DISPUTED_RE.test(trimmed);
}

export function isRepeat(text: string, previous: string | undefined): boolean {
  if (!previous || extractKeywords(text).size < REPEAT_MIN_KEYWORDS) return false;
  return similarity(text, previous) >= REPEAT_SIMILARITY;
}

function isShortGoAhead(sentence: string): boolean {
  return GO_AHEAD_RE.test(sentence) && sentence.split(/\s+/).length <= GO_AHEAD_MAX_WORDS;
}

function sentences(text: string): string[] {
  return text
    .split(/[.!\n]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAcceptance(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes("?") || FAILURE_RE.test(trimmed)) return false;
  if (HEDGE_RE.test(trimmed.split(/[.!?\n]/)[0])) return false;
  if (APPROVAL_RE.test(trimmed) || BARE_OK_RE.test(trimmed)) return true;
  const all = sentences(trimmed);
  if (isShortGoAhead(all.at(-1) ?? "")) return true;
  return isShortGoAhead(all[0] ?? "") && !HEDGE_RE.test(trimmed);
}

/** A yes or a go only gives permission to continue; approval judges the work itself. */
function praisesTheResult(text: string): boolean {
  return PRAISE_RE.test(text);
}

/** Word overlap was measured against real messages and does not separate topics; only saying so does. */
function isNewTopic(text: string): boolean {
  return NEW_TOPIC_RE.test(text.trim());
}

export function reactionTo(text: string, previousPrompt: string | undefined): Reaction {
  if (isCorrection(text)) return "corrected";
  if (isRepeat(text, previousPrompt)) return "repeated";
  if (isAcceptance(text)) return praisesTheResult(text) ? "approved" : "go-ahead";
  if (isNewTopic(text)) return "new-topic";
  return "follow-up";
}
