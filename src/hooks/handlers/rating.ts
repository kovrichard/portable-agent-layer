/**
 * UserPromptSubmit handler: detects explicit and implicit ratings.
 * Ported from original PAI's RatingCapture.hook.ts with rich sentiment analysis.
 *
 * - Explicit: "7", "8 - great work", "rating: 8"
 * - Implicit: Haiku-powered sentiment inference on every user message
 * - Low ratings (<5) write detailed learning markdown
 * - Very low ratings (<=3) write pending-failure.json for Stop handler
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inference } from "../lib/inference";
import { paths } from "../lib/paths";
import { emitRating } from "../lib/signals";
import { now } from "../lib/time";
import { logTokenUsage } from "../lib/token-usage";

/** Read cached last assistant response (written by StopOrchestrator), looked up by session */
function getLastResponse(sessionId?: string): string {
  try {
    const cachePath = resolve(paths.state(), "last-responses.json");
    if (!existsSync(cachePath)) return "";
    const cache = JSON.parse(readFileSync(cachePath, "utf-8")) as Record<
      string,
      { response?: string }
    >;
    // Look up by session, or fall back to most recent entry
    if (sessionId && cache[sessionId]) {
      return cache[sessionId].response ?? "";
    }
    // No session match — return empty rather than wrong context
    return "";
  } catch {
    /* non-critical */
  }
  return "";
}

// ── Explicit Rating Detection ──

/**
 * Parse explicit rating pattern from prompt.
 * Matches: "7", "8 - good work", "6: needs work", "9 excellent", "10!"
 * Rejects: "3 items", "5 things to fix", "7th thing", "10/10"
 */
export function parseExplicitRating(
  prompt: string
): { rating: number; comment?: string } | null {
  const trimmed = prompt.trim();
  const match = new RegExp(/^(10|[1-9])(?:\s*[-:,]\s*|\s+)?(.*)$/).exec(trimmed);
  if (!match) return null;

  const rating = parseInt(match[1], 10);
  if (rating < 1 || rating > 10) return null;

  // Reject if char after number is not a separator (catches "10/10", "3.5", "7th")
  const afterNumber = trimmed.slice(match[1].length);
  if (afterNumber.length > 0 && /^[/.\dA-Za-z]/.test(afterNumber)) return null;

  const rest = match[2]?.trim() || undefined;

  // Reject if rest starts with words indicating a sentence, not a rating
  if (rest) {
    const sentenceStarters =
      /^(items?|things?|steps?|files?|lines?|bugs?|issues?|errors?|times?|minutes?|hours?|days?|seconds?|percent|%|th\b|st\b|nd\b|rd\b|of\b|in\b|at\b|to\b|the\b|a\b|an\b)/i;
    if (sentenceStarters.test(rest)) return null;

    // Reject item selections: "1 and 2", "2 3 5", "1, 3, 5", "1-3"
    if (/^(and\b|\d|,\s*\d|-\d)/.test(rest)) return null;
  }

  return { rating, comment: rest };
}

// ── Praise Fast-Path ──

const POSITIVE_PRAISE_WORDS = new Set([
  "excellent",
  "amazing",
  "brilliant",
  "fantastic",
  "wonderful",
  "incredible",
  "awesome",
  "perfect",
  "great",
  "nice",
  "superb",
  "outstanding",
  "stellar",
  "phenomenal",
  "remarkable",
  "terrific",
  "splendid",
]);

const POSITIVE_PHRASES = new Set([
  "great job",
  "good job",
  "nice work",
  "well done",
  "nice job",
  "good work",
  "love it",
  "nailed it",
  "looks great",
  "looks good",
  "rock solid",
  "thats great",
  "that works",
  "thank you",
  "thanks",
]);

function isPraise(prompt: string): boolean {
  const normalized = prompt
    .trim()
    .toLowerCase()
    .replace(/[.!?,'"]/g, "");
  const words = normalized.split(/\s+/);
  if (words.length > 3) return false;
  return (
    POSITIVE_PRAISE_WORDS.has(normalized) ||
    POSITIVE_PHRASES.has(normalized) ||
    (words.length === 2 && words.every((w) => POSITIVE_PRAISE_WORDS.has(w)))
  );
}

// ── System-Injected Tag Stripping ──

/**
 * Strip IDE/system-injected XML tags from the prompt to recover the raw user text.
 * Claude Code VSCode extension prepends tags like <ide_opened_file>...</ide_opened_file>
 * and <ide_selection>...</ide_selection> to the prompt field in hooks.
 */
const INJECTED_TAG_RE =
  /<(?:ide_opened_file|ide_selection|system-reminder|task-notification)[^>]*>[\s\S]*?<\/(?:ide_opened_file|ide_selection|system-reminder|task-notification)>/gi;

function stripInjectedTags(prompt: string): string {
  return prompt.replace(INJECTED_TAG_RE, "").trim();
}

// ── System Text Filters ──

const SYSTEM_TEXT_PATTERNS = [
  /^<task-notification>/i,
  /^<system-reminder>/i,
  /^This session is being continued from a previous conversation/i,
  /^Please continue the conversation/i,
  /^Note:.*was read before/i,
];

function isSystemText(prompt: string): boolean {
  const trimmed = prompt.trim();
  return SYSTEM_TEXT_PATTERNS.some((re) => re.test(trimmed));
}

// ── Sentiment Analysis ──

const SENTIMENT_SCHEMA = {
  type: "object",
  properties: {
    rating: { type: ["number", "null"] },
    sentiment: { enum: ["positive", "negative", "neutral"] },
    confidence: { type: "number" },
    summary: { type: "string" },
    detailed_context: { type: "string" },
    principle: { type: "string" },
  },
  required: [
    "rating",
    "sentiment",
    "confidence",
    "summary",
    "detailed_context",
    "principle",
  ],
  additionalProperties: false,
} as const;

interface SentimentResult {
  rating: number | null;
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
  summary: string;
  detailed_context: string;
  principle: string;
}

const SENTIMENT_SYSTEM_PROMPT = `Analyze the user's message for emotional sentiment toward the AI assistant.

OUTPUT FORMAT (JSON only):
{
  "rating": <1-10 or null>,
  "sentiment": "positive" | "negative" | "neutral",
  "confidence": <0.0-1.0>,
  "summary": "<brief explanation, 10 words max>",
  "detailed_context": "<comprehensive analysis, 50-150 words>",
  "principle": "<one actionable rule the AI should follow to avoid this failure or repeat this success, 10-20 words. Start with a verb: 'Verify...', 'Always...', 'Never...', 'Ask before...'>"
}

DETAILED_CONTEXT REQUIREMENTS:
1. What the user was trying to accomplish
2. What the AI did (or failed to do)
3. Why the user reacted this way (root cause)
4. What specific behavior triggered this reaction
5. What the AI should do differently (negative) or what worked (positive)

RATING SCALE:
- 1-2: Strong frustration, anger, disappointment
- 3-4: Mild frustration, dissatisfaction
- 5: Neutral
- 6-7: Satisfaction, approval
- 8-9: Strong approval, impressed
- 10: Extraordinary enthusiasm

CRITICAL DISTINCTIONS:
- Profanity can indicate EITHER frustration OR excitement — use context
- Sarcasm: "Oh great, another error" = negative despite "great"
- Short praise ("great job", "nice") = STRONG APPROVAL (8-9), not mild

IMPLIED SENTIMENT (most feedback is implied, not explicit):

Implied NEGATIVE (rate 2-4):
- CORRECTIONS: "No, I meant..." / "That's not what I said" -> 3-4
- REPEATED REQUESTS: Having to ask the same thing twice -> 2-3
- BEHAVIORAL CORRECTIONS: "Don't do that" / "Stop doing X" -> 3
- EXASPERATED QUESTIONS: "Why is this still broken?" -> 2-3
- SHORT DISMISSALS: "whatever" / "fine" / "just do it" -> 3-4
- POINTING OUT OMISSIONS: "What about X?" (obviously required) -> 4

Implied POSITIVE (rate 6-8):
- TRUST SIGNALS: "Alright, fix all of it" / "Go ahead" -> 7
- BUILDING ON WORK: "Now also add..." / "Next, do..." -> 6-7
- ENGAGED FOLLOW-UPS: "What about X?" (exploring, not correcting) -> 6
- MOVING FORWARD: Accepting output and giving next task -> 6

WHEN TO RETURN null FOR RATING:
- Neutral technical questions ("Can you check the logs?")
- Simple commands ("Do it", "Yes", "Continue")
- No emotional indicators present`;

const MIN_CONFIDENCE = 0.5;

// ── Rating Handling ──

function handleRating(
  rating: number,
  context: string,
  source: string,
  detailedContext?: string,
  principle?: string,
  sessionId?: string,
  userMessage?: string
): void {
  const responsePreview = getLastResponse(sessionId).slice(0, 500);
  emitRating(rating, context, source, responsePreview);

  if (rating <= 4) {
    // Low rating — write pending file for Stop handler with full transcript
    const userPreview = userMessage?.slice(0, 400);
    writeFileSync(
      resolve(paths.state(), "pending-failure.json"),
      JSON.stringify(
        {
          rating,
          context,
          source,
          detailedContext,
          principle,
          responsePreview,
          userPreview,
          cwd: process.cwd(),
          ts: now(),
        },
        null,
        2
      ),
      "utf-8"
    );
  }
}

// ── Implicit Sentiment ──

async function handleImplicitSentiment(
  message: string,
  sessionId?: string
): Promise<void> {
  const trimmed = message.trim();

  // Fast-path: short praise -> rating 8
  if (isPraise(trimmed)) {
    handleRating(
      8,
      `Direct praise: "${trimmed}"`,
      "implicit",
      undefined,
      undefined,
      sessionId,
      trimmed
    );
    return;
  }

  // Skip system-injected text
  if (isSystemText(trimmed)) return;

  // Skip very short, very long, or code-like messages
  if (trimmed.length < 5 || trimmed.length > 500) return;
  if (/^[/$`{]/.test(trimmed) || trimmed.includes("\n\n")) return;

  const lastResponse = getLastResponse(sessionId).slice(0, 300);
  const contextBlock = lastResponse
    ? `CONTEXT (last AI response excerpt):\n${lastResponse}\n\nCURRENT USER MESSAGE:\n${trimmed.slice(0, 300)}`
    : trimmed.slice(0, 300);

  const result = await inference({
    system: SENTIMENT_SYSTEM_PROMPT,
    user: contextBlock,
    maxTokens: 500,
    timeout: 8000,
    jsonSchema: SENTIMENT_SCHEMA,
  });

  if (result.usage) logTokenUsage("rating", result.usage);

  if (!result.success || !result.output) return;

  try {
    const parsed = JSON.parse(result.output) as SentimentResult;

    // Skip if no sentiment detected or low confidence
    if (parsed.rating === null) return;
    if (parsed.confidence < MIN_CONFIDENCE) return;

    const rating = parsed.rating;
    if (typeof rating === "number" && rating >= 1 && rating <= 10 && rating !== 5) {
      handleRating(
        rating,
        `${parsed.summary}: ${trimmed.slice(0, 200)}`,
        "implicit",
        parsed.detailed_context,
        parsed.principle,
        sessionId,
        trimmed
      );
    }
  } catch (err) {
    const { logError } = await import("../lib/log");
    logError("rating:implicit", err);
  }
}

// ── Main Export ──

export async function captureRating(message: string, sessionId?: string): Promise<void> {
  // Strip IDE/system-injected tags to recover raw user text
  const cleaned = stripInjectedTags(message);

  // Path 1: Explicit rating
  const explicit = parseExplicitRating(cleaned);
  if (explicit) {
    handleRating(
      explicit.rating,
      explicit.comment || cleaned.slice(0, 200),
      "explicit",
      undefined,
      undefined,
      sessionId,
      cleaned
    );
    return;
  }

  // Path 2: Implicit sentiment (requires PAL_ANTHROPIC_API_KEY — inference silently no-ops without it)
  await handleImplicitSentiment(cleaned, sessionId);
}
