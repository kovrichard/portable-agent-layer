/**
 * Compute rating averages from ratings.jsonl, cache in signal-cache.json.
 * Returns today / this-week / this-month averages + trend direction.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { paths } from "./paths";

interface RatingSignal {
  ts: string;
  rating: number;
}

interface SignalCache {
  computed_at: string;
  today: number | null;
  week: number | null;
  month: number | null;
  trend: "up" | "down" | "stable" | null;
}

function cacheFilePath(): string {
  return resolve(paths.state(), "signal-cache.json");
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function trendDirection(week: number | null, month: number | null): "up" | "down" | "stable" | null {
  if (week === null || month === null) return null;
  if (week > month + 0.5) return "up";
  if (week < month - 0.5) return "down";
  return "stable";
}

/** Read ratings.jsonl and compute trend stats, with 10-minute cache. */
export function computeSignalTrends(): SignalCache {
  const cachePath = cacheFilePath();

  // Return cached value if fresh (< 10 minutes old)
  if (existsSync(cachePath)) {
    try {
      const cache = JSON.parse(readFileSync(cachePath, "utf-8")) as SignalCache;
      const age = Date.now() - new Date(cache.computed_at).getTime();
      if (age < 10 * 60 * 1000) return cache;
    } catch {
      // Recompute
    }
  }

  const ratingsPath = resolve(paths.signals(), "ratings.jsonl");
  if (!existsSync(ratingsPath)) {
    const empty: SignalCache = { computed_at: new Date().toISOString(), today: null, week: null, month: null, trend: null };
    writeFileSync(cachePath, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }

  const now = new Date();
  const todayStart = new Date(now.toISOString().slice(0, 10)).getTime();
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  const todayRatings: number[] = [];
  const weekRatings: number[] = [];
  const monthRatings: number[] = [];

  for (const line of readFileSync(ratingsPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const signal = JSON.parse(line) as RatingSignal;
      if (typeof signal.rating !== "number") continue;
      const ts = new Date(signal.ts).getTime();
      if (ts >= monthAgo) monthRatings.push(signal.rating);
      if (ts >= weekAgo) weekRatings.push(signal.rating);
      if (ts >= todayStart) todayRatings.push(signal.rating);
    } catch {
      // Skip malformed lines
    }
  }

  const week = avg(weekRatings);
  const month = avg(monthRatings);
  const result: SignalCache = {
    computed_at: new Date().toISOString(),
    today: avg(todayRatings),
    week,
    month,
    trend: trendDirection(week, month),
  };

  writeFileSync(cachePath, JSON.stringify(result, null, 2), "utf-8");
  return result;
}

/** Format signal trends as a short markdown string for system-reminder injection */
export function formatTrends(cache: SignalCache): string {
  if (cache.today === null && cache.week === null) return "";

  const parts: string[] = [];
  if (cache.today !== null) parts.push(`today: ${cache.today}/10`);
  if (cache.week !== null) parts.push(`7d avg: ${cache.week}/10`);
  if (cache.trend) parts.push(`trend: ${cache.trend}`);

  return `**Signal trends** — ${parts.join(" | ")}`;
}
