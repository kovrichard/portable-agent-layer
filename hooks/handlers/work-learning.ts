/**
 * Stop handler: writes a structured learning file for significant sessions.
 * Dedup: only writes once per session ID (tracks in a marker file).
 * Threshold: >2000 chars transcript + at least 6 messages.
 * Output: memory/learning/session/YYYY-MM/{datetime}_work_{slug}.md
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inference } from "../lib/inference";
import { categorizeLearning } from "../lib/learning-category";
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

/** Track which sessions already have learning files */
function alreadyCaptured(sessionId: string): boolean {
  const markerPath = resolve(paths.state(), "captured-learnings.json");
  if (!existsSync(markerPath)) return false;
  try {
    const data = JSON.parse(readFileSync(markerPath, "utf-8"));
    return Array.isArray(data) && data.includes(sessionId);
  } catch {
    return false;
  }
}

function markCaptured(sessionId: string): void {
  const markerPath = resolve(paths.state(), "captured-learnings.json");
  let data: string[] = [];
  try {
    if (existsSync(markerPath)) {
      data = JSON.parse(readFileSync(markerPath, "utf-8"));
    }
  } catch {
    /* start fresh */
  }
  data.push(sessionId);
  // Keep last 50
  writeFileSync(markerPath, JSON.stringify(data.slice(-50)), "utf-8");
}

export async function captureWorkLearning(
  transcript: string,
  sessionId?: string
): Promise<void> {
  if (sessionId && alreadyCaptured(sessionId)) return;
  if (transcript.length < 2000) return;

  const messages = parseMessages(transcript);
  if (messages.length < 6) return;

  const lastUser = extractLastUser(messages);
  const lastAssistant = extractLastAssistant(messages);

  const rawTitle = extractContent(lastUser).slice(0, 80) || "session";
  const summary = extractContent(lastAssistant).slice(0, 600);

  // Generate a meaningful title from the session context
  let title = rawTitle;
  try {
    const userMessages = messages
      .filter((m) => m.role === "user")
      .map((m) => extractContent(m).slice(0, 100))
      .slice(0, 5)
      .join("\n");
    const result = await inference({
      system:
        "Summarize what was accomplished in this AI coding session in one short phrase (5-10 words). No quotes, no punctuation at the end. Examples: 'Fixed PDF download and archive pipeline', 'Refactored rating handler to save response context'.",
      user: `User messages:\n${userMessages}\n\nLast assistant summary:\n${summary.slice(0, 300)}`,
      maxTokens: 30,
      timeout: 5000,
    });
    if (result.success && result.output) {
      title = result.output.replace(/^["']|["']$/g, "").slice(0, 100);
    }
  } catch {
    // Fallback to raw title
  }
  const category = categorizeLearning(title, summary);

  const slug = slugify(title);
  const dir = ensureDir(resolve(paths.sessionLearning(), monthPath()));
  const filename = `${fileTimestamp()}_${category}_${slug}.md`;

  const content = [
    "# Work Completion Learning",
    `**Title:** ${title}`,
    `**Category:** ${category.toUpperCase()}`,
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    ...(sessionId ? [`**Session:** ${sessionId}`] : []),
    "",
    "## What Was Done",
    summary,
    "",
    "## Insights",
    "*Auto-captured. What made this effective? Any blockers or surprises?*",
    "",
  ].join("\n");

  writeFileSync(resolve(dir, filename), content, "utf-8");

  if (sessionId) markCaptured(sessionId);
}
