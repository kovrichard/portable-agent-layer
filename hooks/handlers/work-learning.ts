/**
 * Stop handler: writes a structured learning file for significant sessions.
 * Threshold: >500 chars transcript + at least 4 messages.
 * Output: memory/learning/session/YYYY-MM/{datetime}_work_{slug}.md
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
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-");
}

export async function captureWorkLearning(transcript: string): Promise<void> {
  if (transcript.length < 500) return;

  const messages = parseMessages(transcript);
  if (messages.length < 4) return;

  const lastUser = extractLastUser(messages);
  const lastAssistant = extractLastAssistant(messages);

  const title = extractContent(lastUser).slice(0, 80) || "session";
  const summary = extractContent(lastAssistant).slice(0, 600);

  const slug = slugify(title);
  const dir = ensureDir(resolve(paths.sessionLearning(), monthPath()));
  const filename = `${fileTimestamp()}_work_${slug}.md`;

  const content = [
    "# Work Completion Learning",
    `**Title:** ${title}`,
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    "",
    "## What Was Done",
    summary,
    "",
    "## Insights",
    "*Auto-captured. What made this effective? Any blockers or surprises?*",
    "",
  ].join("\n");

  writeFileSync(resolve(dir, filename), content, "utf-8");
}
