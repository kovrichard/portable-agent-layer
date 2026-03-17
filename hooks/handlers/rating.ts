/**
 * UserPromptSubmit handler: detects explicit and implicit ratings.
 * Extracted from RatingCapture.ts — pure handler function.
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { emitRating } from "../lib/signals";
import { paths } from "../lib/paths";
import { fileTimestamp, monthPath } from "../lib/time";
import { inference } from "../lib/inference";

// Match: "8", "8/10", "8 - great work", "rating: 8", "score: 8"
const EXPLICIT_RE =
  /(?:^|rating:?\s*|score:?\s*)(\d|10)(?:\s*(?:\/10|[-.])|$|\s)/i;

const PRAISE_PATTERNS =
  /^(great\s*job|nice|perfect|awesome|excellent|thanks|thank\s*you|well\s*done|good\s*job|love\s*it|amazing|brilliant|fantastic|wonderful|superb|nailed\s*it)[.!]?$/i;

function handleRating(rating: number, context: string, source: string): void {
  emitRating(rating, context, source);

  if (rating < 6) {
    const dir = resolve(paths.learning(), "low-ratings", monthPath());
    mkdirSync(dir, { recursive: true });

    writeFileSync(
      resolve(dir, `${fileTimestamp()}.md`),
      [
        `# Low Rating: ${rating}/10`,
        `**Source:** ${source}`,
        `**User said:** ${context}`,
        "",
        "## What went wrong?",
        "",
        "## What should be done differently?",
        "",
      ].join("\n")
    );
  }
}

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
    user: `Rate the sentiment of this user message toward an AI assistant on a 1-10 scale (1=very negative, 5=neutral, 10=very positive). If the message has no clear sentiment toward the assistant, respond with just "neutral". Otherwise respond with just a JSON object: {"rating": N, "sentiment": "one-word"}

Message: "${trimmed.slice(0, 300)}"`,
    maxTokens: 100,
    timeout: 5000,
  });

  if (!result.success || !result.output || result.output === "neutral") return;

  try {
    const parsed = JSON.parse(result.output) as { rating?: number; sentiment?: string };
    const rating = parsed.rating;
    if (typeof rating === "number" && rating >= 1 && rating <= 10 && rating !== 5) {
      handleRating(
        rating,
        `${parsed.sentiment ?? "inferred"}: ${trimmed.slice(0, 150)}`,
        "implicit"
      );
    }
  } catch {
    // Haiku didn't return valid JSON — skip
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

  if (process.env.PAI_IMPLICIT_SENTIMENT === "1") {
    await handleImplicitSentiment(message);
  }
}
