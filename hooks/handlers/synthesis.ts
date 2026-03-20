/**
 * Auto-trigger pattern synthesis on Stop when conditions are met:
 * - 7+ days since last synthesis report
 * - 20+ new ratings since last synthesis
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug } from "../lib/log";
import { paths } from "../lib/paths";

const MIN_DAYS_BETWEEN = 7;
const MIN_NEW_RATINGS = 20;

function getLastSynthesisDate(): Date | null {
  try {
    const synthDir = paths.synthesis();
    if (!existsSync(synthDir)) return null;

    const months = readdirSync(synthDir).sort().reverse();
    for (const month of months) {
      const monthDir = resolve(synthDir, month);
      const files = readdirSync(monthDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();
      if (files.length > 0) {
        // Filename: YYYY-MM-DD_period-patterns.md
        const dateStr = files[0].slice(0, 10);
        const date = new Date(dateStr);
        if (!Number.isNaN(date.getTime())) return date;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function countRatingsSince(since: Date | null): number {
  try {
    const ratingsFile = resolve(paths.signals(), "ratings.jsonl");
    if (!existsSync(ratingsFile)) return 0;

    const lines = readFileSync(ratingsFile, "utf-8").trim().split("\n");
    if (!since) return lines.length;

    let count = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { ts?: string };
        if (entry.ts && new Date(entry.ts) > since) count++;
      } catch {
        /* skip bad lines */
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export async function checkSynthesisTrigger(): Promise<void> {
  const lastDate = getLastSynthesisDate();
  const now = new Date();

  // Check days since last synthesis
  if (lastDate) {
    const daysSince = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < MIN_DAYS_BETWEEN) {
      logDebug(
        "synthesis",
        `Skipping: only ${daysSince.toFixed(1)} days since last report`
      );
      return;
    }
  }

  // Check new rating count
  const newRatings = countRatingsSince(lastDate);
  if (newRatings < MIN_NEW_RATINGS) {
    logDebug(
      "synthesis",
      `Skipping: only ${newRatings} new ratings (need ${MIN_NEW_RATINGS})`
    );
    return;
  }

  logDebug(
    "synthesis",
    `Triggering: ${newRatings} new ratings, ${lastDate ? "last report: " + lastDate.toISOString().slice(0, 10) : "no previous report"}`
  );

  // Spawn synthesis as a detached process so it doesn't block the Stop handler
  try {
    const paiDir = resolve(import.meta.dir, "../..");
    const proc = Bun.spawn(["bun", "run", "tool:patterns"], {
      cwd: paiDir,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    // Don't await — let it run in background
    proc.unref();
    logDebug("synthesis", "Spawned pattern synthesis in background");
  } catch (err) {
    logDebug("synthesis", `Failed to spawn: ${err}`);
  }
}
