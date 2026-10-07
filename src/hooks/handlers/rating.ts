/**
 * UserPromptSubmit handler: detects explicit and implicit ratings.
 *
 * - Explicit: "7", "8 - great work", "rating: 8"
 * - Implicit: a model labels the reaction to the previous reply; only a confirmed
 *   correction or plain praise becomes a rating
 * - Low ratings (<=4) write pending-failure.json; the Stop handler writes the
 *   lesson from the transcript
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendCandidate, readCandidates } from "../lib/adaptation-candidates";
import { readRules } from "../lib/adaptation-rules";
import { appendTurn, readTurns } from "../lib/adaptation-turns";
import { spawnDetachedInference } from "../lib/detached-inference";
import { canInfer, inference } from "../lib/inference";
import { replyEnd } from "../lib/interaction-samples";
import { logDebug } from "../lib/log";
import { paths } from "../lib/paths";
import { isSystemText, stripInjectedTags } from "../lib/prompt-text";
import {
  isCorrectionLabel,
  parseReactionLabel,
  ratingContext,
  ratingFromLabels,
  reactionRequest,
  turnFromLabels,
} from "../lib/reaction-rating";
import {
  canRepeat,
  correctionsToDraftFrom,
  drafterRequest,
  parseDraft,
} from "../lib/rule-drafter";
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
      /^(items?|things?|steps?|files?|lines?|bugs?|issues?|errors?|times?|minutes?|hours?|days?|seconds?|percent|%|th\b|st\b|nd\b|rd\b|of\b|in\b|at\b|to\b|the\b|a\b|an\b|then\b|also\b|next\b)/i;
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

// ── Rating Handling ──

function handleRating(
  rating: number,
  context: string,
  source: string,
  responsePreview: string,
  userMessage?: string
): void {
  emitRating(rating, context, source, responsePreview);

  if (rating <= 4) {
    writeFileSync(
      resolve(paths.state(), "pending-failure.json"),
      JSON.stringify(
        {
          rating,
          context,
          source,
          responsePreview,
          userPreview: userMessage?.slice(0, 400),
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

// ── Implicit Rating ──

function handleImplicitReaction(message: string, sessionId?: string): void {
  const trimmed = message.trim();
  const reply = replyEnd(getLastResponse(sessionId));

  if (isPraise(trimmed)) {
    handleRating(8, `Direct praise: "${trimmed}"`, "implicit", reply, trimmed);
    return;
  }

  if (isSystemText(trimmed)) return;
  if (!reply) return;

  // Skip very short, very long, or code-like messages
  if (trimmed.length < 5 || trimmed.length > 500) return;
  if (/^[/$`{]/.test(trimmed) || trimmed.includes("\n\n")) return;

  // claude --print has 3-5s of cold start, too slow for UserPromptSubmit.
  // The reply is read here, before the turn's own reply can replace it in the cache.
  if (!canInfer()) return;
  spawnDetachedInference(
    import.meta.filename,
    [
      "--sentiment",
      sessionId ?? "",
      Buffer.from(trimmed).toString("base64"),
      Buffer.from(reply).toString("base64"),
    ],
    "rating"
  );
}

async function labelReaction(reply: string, message: string, sessionId?: string) {
  const result = await inference(reactionRequest(reply, message, sessionId));
  if (result.usage) logTokenUsage("rating", result.usage);
  return result.success ? parseReactionLabel(result.output) : null;
}

function knownRules() {
  return [
    ...readRules(),
    ...readCandidates().map((candidate) => ({ ...candidate, status: "candidate" })),
  ];
}

async function draftRuleCandidate(sessionId?: string): Promise<void> {
  const corrections = correctionsToDraftFrom(readTurns());
  if (!canRepeat(corrections)) return;
  const result = await inference(drafterRequest(corrections, knownRules(), sessionId));
  if (result.usage) logTokenUsage("rule-drafter", result.usage);
  const candidate = result.success ? parseDraft(result.output, corrections) : null;
  if (candidate) appendCandidate(candidate);
  else logDebug("rule-drafter", `no candidate: ${result.output ?? result.error ?? ""}`);
}

/** Background mode: label the reaction, confirm a correction, store the rating. */
async function runReactionRatingAndStore(
  message: string,
  reply: string,
  sessionId?: string
): Promise<void> {
  try {
    const first = await labelReaction(reply, message, sessionId);
    const confirmation = isCorrectionLabel(first)
      ? await labelReaction(reply, message, sessionId)
      : null;
    const rating = ratingFromLabels(first, confirmation);
    if (first && rating !== null) {
      handleRating(rating, ratingContext(first, message), "implicit", reply, message);
    }
    const turn = turnFromLabels(
      { session: sessionId ?? "", message, replyEnd: reply },
      first,
      confirmation
    );
    if (turn) appendTurn(turn);
    if (turn?.confirmed) await draftRuleCandidate(sessionId);
  } catch (err) {
    const { logError } = await import("../lib/log");
    logError("rating:reaction-child", err);
  }
}

// ── Main Export ──

export function captureRating(message: string, sessionId?: string): void {
  // Strip IDE/system-injected tags to recover raw user text
  const cleaned = stripInjectedTags(message);

  // Path 1: Explicit rating
  const explicit = parseExplicitRating(cleaned);
  if (explicit) {
    handleRating(
      explicit.rating,
      explicit.comment || cleaned.slice(0, 200),
      "explicit",
      getLastResponse(sessionId).slice(0, 500),
      cleaned
    );
    return;
  }

  // Path 2: Implicit reaction — the praise fast-path runs synchronously, the
  // model path detaches to a background bun subprocess (mirrors session-name).
  handleImplicitReaction(cleaned, sessionId);
}

// Background reaction entry point
if (process.argv[2] === "--sentiment") {
  const sid = process.argv[3];
  const msgB64 = process.argv[4];
  const replyB64 = process.argv[5];
  if (msgB64 && replyB64) {
    const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf-8");
    await runReactionRatingAndStore(
      decode(msgB64),
      decode(replyB64),
      sid === "" ? undefined : sid
    );
  }
  process.exit(0);
}
