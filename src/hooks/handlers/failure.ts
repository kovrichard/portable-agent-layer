/**
 * Deep Failure Capture — full context dump for ratings 1–3.
 *
 * Stores raw conversation data for later review, matching the original PAI pattern:
 *   capture.md — frontmatter metadata + conversation summary
 *
 * Analysis is left to the human or the graduation pipeline, not auto-generated.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "../lib/frontmatter";
import { ensureDir, paths } from "../lib/paths";
import { fileTimestamp, monthPath } from "../lib/time";
import { extractContent, parseMessages } from "../lib/transcript";

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
  detailedContext?: string
): Promise<void> {
  const messages = parseMessages(transcript);

  // Conversation summary — last 10 exchanges, like the original PAI
  const recentMessages = messages.slice(-10);
  const conversationSummary = recentMessages
    .map((m) => {
      const text = extractContent(m).slice(0, 500);
      return `**${m.role.toUpperCase()}:** ${text}`;
    })
    .join("\n\n");

  const slug = slugify(context);
  const dir = ensureDir(
    resolve(paths.failures(), monthPath(), `${fileTimestamp()}_${slug}`)
  );

  const meta: Record<string, unknown> = {
    rating,
    context,
    date: new Date().toISOString().slice(0, 10),
    ts: new Date().toISOString(),
    slug,
  };

  const body = [
    "## What Happened",
    "",
    detailedContext ||
      "No detailed analysis available. Review the conversation for context.",
    "",
    "## Conversation Summary",
    "",
    conversationSummary || "*(unavailable)*",
  ].join("\n");

  writeFileSync(resolve(dir, "capture.md"), stringify(meta, body), "utf-8");
}
