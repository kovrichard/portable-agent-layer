/**
 * Deep Failure Capture — full context dump for ratings 1–3.
 *
 * Writes to memory/learning/failures/YYYY-MM/{timestamp}_{slug}/
 *   CONTEXT.md    — full failure context with transcript excerpt
 *   sentiment.json — structured rating + metadata
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "../lib/paths";
import { fileTimestamp, monthPath } from "../lib/time";
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
  detailedContext?: string
): Promise<void> {
  const messages = parseMessages(transcript);
  const lastUser = extractContent(extractLastUser(messages)).slice(0, 400);
  const lastAssistant = extractContent(extractLastAssistant(messages)).slice(0, 600);

  const slug = slugify(context);
  const dir = ensureDir(
    resolve(paths.failures(), monthPath(), `${fileTimestamp()}_${slug}`)
  );

  writeFileSync(
    resolve(dir, "CONTEXT.md"),
    [
      `# Failure Capture — Rating ${rating}/10`,
      `**Date:** ${new Date().toISOString().slice(0, 10)}`,
      `**Context:** ${context}`,
      "",
      "## Last User Message",
      lastUser || "*(unavailable)*",
      "",
      "## Last Assistant Response",
      lastAssistant || "*(unavailable)*",
      "",
      ...(detailedContext ? ["## Detailed Analysis", detailedContext, ""] : []),
      "## What Went Wrong?",
      "",
      "## What Should Be Done Differently?",
      "",
    ].join("\n"),
    "utf-8"
  );

  writeFileSync(
    resolve(dir, "sentiment.json"),
    JSON.stringify(
      {
        rating,
        context,
        ts: new Date().toISOString(),
        slug,
      },
      null,
      2
    ),
    "utf-8"
  );
}
