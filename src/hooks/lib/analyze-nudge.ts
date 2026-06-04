/**
 * Analyze nudge — surfaces a session-start reminder when the learning analysis
 * is overdue (≥7 days since last run, or never run).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

const MAX_DAYS = 7;
const DAY_MS = 86_400_000;

function markFile(): string {
  return resolve(paths.state(), "last-analyze.json");
}

function readLastAnalyzeDate(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(markFile(), "utf-8"));
    return typeof parsed.lastAnalyzedTs === "string" ? parsed.lastAnalyzedTs : null;
  } catch {
    return null;
  }
}

export function writeLastAnalyzeDate(ts: string): void {
  writeFileSync(markFile(), `${JSON.stringify({ lastAnalyzedTs: ts }, null, 2)}\n`);
}

export function loadAnalyzeNudge(now: Date = new Date()): string {
  const last = readLastAnalyzeDate();
  if (!last) {
    return [
      "## Learning Analysis Due",
      "📊 Learning analysis has never been run — offer to run `/pal-analyze` (`pal cli analyze`) for a health check on ratings, failure patterns, and graduation candidates.",
    ].join("\n");
  }

  const daysSince = (now.getTime() - new Date(last).getTime()) / DAY_MS;
  if (daysSince < MAX_DAYS) return "";

  const since = new Date(last).toISOString().slice(0, 10);
  return [
    "## Learning Analysis Due",
    `📊 Learning analysis last run ${Math.floor(daysSince)}d ago (${since}) — offer to run \`/pal-analyze\` for a health check.`,
  ].join("\n");
}
