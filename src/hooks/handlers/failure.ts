/**
 * Deep Failure Capture — full context dump for ratings 1–3.
 *
 * Writes to memory/learning/failures/YYYY-MM/{timestamp}_{slug}/
 *   capture.md     — frontmatter metadata + failure context body
 *   sentiment.json — DEPRECATED legacy format (kept for backward compat)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "../lib/frontmatter";
import { inference } from "../lib/inference";
import { ensureDir, paths } from "../lib/paths";
import { fileTimestamp, monthPath } from "../lib/time";
import { logTokenUsage } from "../lib/token-usage";
import {
  extractContent,
  extractLastAssistant,
  extractLastUser,
  parseMessages,
} from "../lib/transcript";

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 8)
      .join("-") || "failure"
  );
}

export async function captureFailure(
  rating: number,
  context: string,
  transcript: string,
  detailedContext?: string,
  savedResponse?: string,
  savedUserMessage?: string
): Promise<void> {
  const messages = parseMessages(transcript);
  // Prefer messages saved at rating time (before the AI replied to the rating)
  const lastUser =
    savedUserMessage?.slice(0, 400) ||
    extractContent(extractLastUser(messages)).slice(0, 400);
  const lastAssistant =
    savedResponse?.slice(0, 600) ||
    extractContent(extractLastAssistant(messages)).slice(0, 600);

  const slug = slugify(context);
  const dir = ensureDir(
    resolve(paths.failures(), monthPath(), `${fileTimestamp()}_${slug}`)
  );

  // Attempt inference to fill root cause analysis
  let whatWentWrong = "";
  let whatToDoDifferently = "";
  try {
    const analysisResult = await inference({
      system:
        "You are analyzing a failed AI assistant interaction. Based on the context, identify what went wrong and what should be done differently. Be specific and actionable.",
      user: [
        `Rating: ${rating}/10`,
        `Context: ${context}`,
        detailedContext ? `Analysis: ${detailedContext}` : "",
        `User said: ${lastUser}`,
        `Assistant said: ${lastAssistant}`,
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 300,
      timeout: 8000,
      jsonSchema: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          what_went_wrong: { type: "string" as const },
          what_to_do_differently: { type: "string" as const },
        },
        required: ["what_went_wrong", "what_to_do_differently"],
      },
    });
    if (analysisResult.usage) logTokenUsage("failure", analysisResult.usage);
    if (analysisResult.success && analysisResult.output) {
      const parsed = JSON.parse(analysisResult.output) as {
        what_went_wrong?: string;
        what_to_do_differently?: string;
      };
      whatWentWrong = parsed.what_went_wrong ?? "";
      whatToDoDifferently = parsed.what_to_do_differently ?? "";
    }
  } catch {
    // Graceful fallback — empty sections are still useful with the other context
  }

  const meta: Record<string, unknown> = {
    rating,
    context,
    date: new Date().toISOString().slice(0, 10),
    ts: new Date().toISOString(),
    slug,
  };

  const body = [
    "## Last User Message",
    lastUser || "*(unavailable)*",
    "",
    "## Last Assistant Response",
    lastAssistant || "*(unavailable)*",
    "",
    ...(detailedContext ? ["## AI Response Context", detailedContext, ""] : []),
    "## What Went Wrong?",
    whatWentWrong || "",
    "",
    "## What Should Be Done Differently?",
    whatToDoDifferently || "",
  ].join("\n");

  writeFileSync(resolve(dir, "capture.md"), stringify(meta, body), "utf-8");

  // DEPRECATED: legacy sentiment.json — remove once all readers use capture.md frontmatter
  writeFileSync(
    resolve(dir, "sentiment.json"),
    JSON.stringify({ rating, context, ts: new Date().toISOString(), slug }, null, 2),
    "utf-8"
  );
}
