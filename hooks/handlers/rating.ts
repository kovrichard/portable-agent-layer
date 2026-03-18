/**
 * UserPromptSubmit handler: detects explicit and implicit ratings.
 * Extracted from RatingCapture.ts — pure handler function.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inference } from "../lib/inference";
import { paths } from "../lib/paths";
import { emitRating } from "../lib/signals";
import { fileTimestamp, monthPath, now } from "../lib/time";

/** Read cached last assistant response (written by StopOrchestrator) */
function getLastResponse(): string {
  try {
    const cachePath = resolve(paths.state(), "last-response.txt");
    if (existsSync(cachePath)) return readFileSync(cachePath, "utf-8");
  } catch {
    /* non-critical */
  }
  return "";
}

// Match: "8", "8/10", "8 - great work", "rating: 8", "score: 8"
const EXPLICIT_RE = /(?:^|rating:?\s*|score:?\s*)(\d|10)(?:\s*(?:\/10|[-.])|$|\s)/i;

const PRAISE_PATTERNS =
  /^(great\s*job|nice|perfect|awesome|excellent|thanks|thank\s*you|well\s*done|good\s*job|love\s*it|amazing|brilliant|fantastic|wonderful|superb|nailed\s*it)[.!]?$/i;

function handleRating(rating: number, context: string, source: string): void {
  const responsePreview = getLastResponse().slice(0, 500);
  emitRating(rating, context, source, responsePreview);

  if (rating <= 3) {
    // Deep failure — write pending file for Stop handler to pick up with full transcript
    writeFileSync(
      resolve(paths.state(), "pending-failure.json"),
      JSON.stringify({ rating, context, source, ts: now() }, null, 2),
      "utf-8"
    );
  } else if (rating < 6) {
    // Low rating but not critical — write simple low-ratings note
    const dir = resolve(paths.learning(), "low-ratings", monthPath());
    mkdirSync(dir, { recursive: true });

    writeFileSync(
      resolve(dir, `${fileTimestamp()}.md`),
      [
        `# Low Rating: ${rating}/10`,
        `**Source:** ${source}`,
        `**User said:** ${context}`,
        `**Last response:** ${responsePreview.slice(0, 200) || "(unavailable)"}`,
        "",
        "## What went wrong?",
        "",
        "## What should be done differently?",
        "",
      ].join("\n")
    );
  }
}

const SENTIMENT_SCHEMA = {
  type: "object",
  properties: {
    rating: { type: ["number", "null"] },
    sentiment: { type: "string" },
    neutral: { type: "boolean" },
  },
  required: ["rating", "sentiment", "neutral"],
  additionalProperties: false,
} as const;

async function handleImplicitSentiment(message: string): Promise<void> {
  const trimmed = message.trim();

  // Fast-path: short praise → rating 8
  if (PRAISE_PATTERNS.test(trimmed)) {
    handleRating(8, trimmed, "implicit");
    return;
  }

  // Skip very short, very long, or code-like messages
  if (trimmed.length < 5 || trimmed.length > 500) return;
  if (/^[/$`{]/.test(trimmed) || trimmed.includes("\n\n")) return;

  const result = await inference({
    user: `Rate the sentiment of this user message toward an AI assistant. If the message has no clear sentiment toward the assistant, set neutral to true and rating to null. Otherwise, provide a rating (1=very negative, 5=neutral, 10=very positive) and a one-word sentiment description.

Message: "${trimmed.slice(0, 300)}"`,
    maxTokens: 100,
    timeout: 5000,
    jsonSchema: SENTIMENT_SCHEMA,
  });

  if (!result.success || !result.output) return;

  try {
    const parsed = JSON.parse(result.output) as {
      rating: number | null;
      sentiment: string;
      neutral: boolean;
    };

    // Skip if explicitly neutral or no valid rating
    if (parsed.neutral || parsed.rating === null) return;

    const rating = parsed.rating;
    if (typeof rating === "number" && rating >= 1 && rating <= 10 && rating !== 5) {
      handleRating(
        rating,
        `${parsed.sentiment ?? "inferred"}: ${trimmed.slice(0, 150)}`,
        "implicit"
      );
    }
  } catch (err) {
    const { logError } = await import("../lib/log");
    logError("rating:implicit", err);
  }
}

export async function captureRating(message: string): Promise<void> {
  const match = message.match(EXPLICIT_RE);
  if (match) {
    const rating = parseInt(match[1], 10);
    if (rating >= 1 && rating <= 10) {
      handleRating(rating, message.slice(0, 200), "explicit");
      return;
    }
  }

  // Implicit sentiment: auto-enabled when ANTHROPIC_API_KEY is set
  if (process.env.ANTHROPIC_API_KEY) {
    await handleImplicitSentiment(message);
  }
}
