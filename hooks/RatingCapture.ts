/**
 * Hook: UserPromptSubmit — Detects explicit ratings (1-10) in user messages.
 * Captures rating + context to signals log. Low ratings trigger learning capture.
 *
 * When PAI_IMPLICIT_SENTIMENT=1:
 * - Fast-path: short praise words → rating 8, no API call
 * - Otherwise: call Anthropic API (Haiku) to infer sentiment → rating + context
 */

import { writeFileSync } from "fs";
import { resolve } from "path";
import { readStdinJSON } from "./lib/stdin";
import { emitRating } from "./lib/signals";
import { paths } from "./lib/paths";
import { fileTimestamp, monthPath } from "./lib/time";

interface PromptSubmitInput {
  message: string;
}

const input = await readStdinJSON<PromptSubmitInput>();
if (!input?.message) process.exit(0);

const msg = input.message;

// Match: "8", "8/10", "8 - great work", "rating: 8", "score: 8"
const match = msg.match(/(?:^|rating:?\s*|score:?\s*)(\d|10)(?:\s*(?:\/10|[-.])|$|\s)/i);

if (match) {
  const rating = parseInt(match[1], 10);
  if (rating >= 1 && rating <= 10) {
    handleRating(rating, msg.slice(0, 200), "explicit");
    process.exit(0);
  }
}

// --- Implicit sentiment (opt-in) ---
if (process.env.PAI_IMPLICIT_SENTIMENT === "1") {
  await handleImplicitSentiment(msg);
}

// --- Helpers ---

function handleRating(rating: number, context: string, source: string): void {
  emitRating(rating, context, source);

  // Low ratings get extra attention
  if (rating < 6) {
    const dir = resolve(paths.learning(), "low-ratings", monthPath());
    const { mkdirSync } = require("fs");
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

// Fast-path praise patterns → rating 8 without API call
const PRAISE_PATTERNS = /^(great\s*job|nice|perfect|awesome|excellent|thanks|thank\s*you|well\s*done|good\s*job|love\s*it|amazing|brilliant|fantastic|wonderful|superb|nailed\s*it)[.!]?$/i;

async function handleImplicitSentiment(message: string): Promise<void> {
  const trimmed = message.trim();

  // Fast-path: short praise → rating 8
  if (PRAISE_PATTERNS.test(trimmed)) {
    handleRating(8, trimmed, "implicit");
    return;
  }

  // Skip very short messages (likely commands) or very long ones (likely content, not sentiment)
  if (trimmed.length < 5 || trimmed.length > 500) return;

  // Skip messages that look like code or commands
  if (/^[\/\$`{]/.test(trimmed) || trimmed.includes("\n\n")) return;

  // Call Haiku for sentiment inference
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: `Rate the sentiment of this user message toward an AI assistant on a 1-10 scale (1=very negative, 5=neutral, 10=very positive). If the message has no clear sentiment toward the assistant, respond with just "neutral". Otherwise respond with just a JSON object: {"rating": N, "sentiment": "one-word"}

Message: "${trimmed.slice(0, 300)}"`,
          },
        ],
      }),
    });

    if (!response.ok) return;

    const data = await response.json() as any;
    const text = data?.content?.[0]?.text?.trim();
    if (!text || text === "neutral") return;

    try {
      const parsed = JSON.parse(text);
      const rating = parsed.rating;
      if (typeof rating === "number" && rating >= 1 && rating <= 10 && rating !== 5) {
        handleRating(rating, `${parsed.sentiment || "inferred"}: ${trimmed.slice(0, 150)}`, "implicit");
      }
    } catch {
      // Haiku didn't return valid JSON — skip
    }
  } catch {
    // API call failed — skip silently
  }
}
