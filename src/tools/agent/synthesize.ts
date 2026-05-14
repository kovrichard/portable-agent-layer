#!/usr/bin/env bun
/**
 * Synthesize — Aggregate recent PAL activity into compact state for hook injection.
 *
 * Deterministic (no LLM call). Reads threads, reflections, session notes,
 * and ratings, then writes compact JSON state that the session-start hook
 * reads and formats with behavioral guidance.
 *
 * Usage:
 *   bun ~/.pal/tools/synthesize.ts [--days 7] [--force]
 *
 * Guards: skips if last synthesis was < 24h ago (unless --force).
 * Output: ~/.pal/memory/state/synthesis.json
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ensureDir, paths } from "../../hooks/lib/paths";
import { readJsonl } from "../self-model";

// ── Config ──

const SYNTHESIS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Types ──

interface SynthesisState {
  timestamp: string;
  days: number;
  sessions: { date: string; titles: string[] }[];
  sessionCount: number;
  ratings: {
    count: number;
    avg: number;
    recentAvg: number;
    lowCount: number;
    trend: "improving" | "declining" | "stable";
  };
  algorithm: {
    reflectionCount: number;
    avgSentiment: number;
    passRate: number;
    criteriaTotal: number;
    criteriaPassed: number;
    recentObservations: {
      date: string;
      cwd?: string;
      task: string;
      observation: string;
    }[];
  };
}

// ── Helpers ──

function stateDir(): string {
  return ensureDir(paths.state());
}

function synthesisPath(): string {
  return resolve(stateDir(), "synthesis.json");
}

function shouldRun(force: boolean): boolean {
  if (force) return true;
  const p = synthesisPath();
  if (!existsSync(p)) return true;
  try {
    const data = JSON.parse(readFileSync(p, "utf-8")) as { timestamp: string };
    return Date.now() - new Date(data.timestamp).getTime() > SYNTHESIS_TTL_MS;
  } catch {
    return true;
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ── Data readers ──

interface Reflection {
  timestamp: string;
  cwd?: string;
  task: string;
  criteria_count: number;
  criteria_passed: number;
  criteria_failed: number;
  sentiment: number;
  q1: string;
}

function getAlgorithmStats(since: Date): SynthesisState["algorithm"] {
  const p = resolve(
    ensureDir(resolve(paths.learning(), "reflections")),
    "algorithm-reflections.jsonl"
  );
  const reflections = readJsonl<Reflection>(p).filter(
    (r) => new Date(r.timestamp) >= since
  );

  if (reflections.length === 0) {
    return {
      reflectionCount: 0,
      avgSentiment: 0,
      passRate: 0,
      criteriaTotal: 0,
      criteriaPassed: 0,
      recentObservations: [],
    };
  }

  const avgSentiment =
    reflections.reduce((s, r) => s + r.sentiment, 0) / reflections.length;
  const criteriaTotal = reflections.reduce((s, r) => s + r.criteria_count, 0);
  const criteriaPassed = reflections.reduce((s, r) => s + r.criteria_passed, 0);
  const passRate =
    criteriaTotal > 0 ? Math.round((criteriaPassed / criteriaTotal) * 100) : 0;

  const recentObservations = reflections.slice(-3).map((r) => ({
    date: formatDate(r.timestamp),
    cwd: r.cwd,
    task: r.task,
    observation: r.q1,
  }));

  return {
    reflectionCount: reflections.length,
    avgSentiment: Math.round(avgSentiment * 10) / 10,
    passRate,
    criteriaTotal,
    criteriaPassed,
    recentObservations,
  };
}

interface Rating {
  ts: string;
  rating: number;
}

function getRatingStats(since: Date): SynthesisState["ratings"] {
  const p = resolve(paths.signals(), "ratings.jsonl");
  const ratings = readJsonl<Rating>(p).filter((r) => new Date(r.ts) >= since);

  if (ratings.length === 0) {
    return { count: 0, avg: 0, recentAvg: 0, lowCount: 0, trend: "stable" };
  }

  const avg = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
  const recent = ratings.slice(-10);
  const recentAvg = recent.reduce((s, r) => s + r.rating, 0) / recent.length;
  const lowCount = ratings.filter((r) => r.rating <= 3).length;

  // Trend: compare first half to second half
  const mid = Math.floor(ratings.length / 2);
  if (mid < 3) {
    return {
      count: ratings.length,
      avg: round1(avg),
      recentAvg: round1(recentAvg),
      lowCount,
      trend: "stable",
    };
  }
  const firstHalf = ratings.slice(0, mid);
  const secondHalf = ratings.slice(mid);
  const firstAvg = firstHalf.reduce((s, r) => s + r.rating, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, r) => s + r.rating, 0) / secondHalf.length;
  const diff = secondAvg - firstAvg;
  const decliningOrStable = diff < -0.5 ? "declining" : "stable";
  const trend = diff > 0.5 ? "improving" : decliningOrStable;

  return {
    count: ratings.length,
    avg: round1(avg),
    recentAvg: round1(recentAvg),
    lowCount,
    trend,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function getRecentSessions(since: Date): {
  sessions: SynthesisState["sessions"];
  count: number;
} {
  const baseDir = resolve(paths.learning(), "session");
  if (!existsSync(baseDir)) return { sessions: [], count: 0 };

  const sinceStr = formatDate(since.toISOString());
  const byDate = new Map<string, string[]>();

  for (const year of safeReaddir(baseDir)) {
    const yearDir = resolve(baseDir, year);
    for (const month of safeReaddir(yearDir)) {
      const monthDir = resolve(yearDir, month);
      for (const file of safeReaddir(monthDir).filter((f) => f.endsWith(".md"))) {
        const dateStr = file.slice(0, 8);
        const isoDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        if (isoDate < sinceStr) continue;

        const content = readFileSync(resolve(monthDir, file), "utf-8");
        const titleMatch =
          new RegExp(/^title:\s*"?(.+?)"?\s*$/m).exec(content) ??
          new RegExp(/^\*\*Title:\*\*\s*(.+?)\s*$/m).exec(content);
        const title = titleMatch?.[1] ?? file.replace(/\.md$/, "");

        const existing = byDate.get(isoDate) ?? [];
        existing.push(title);
        byDate.set(isoDate, existing);
      }
    }
  }

  const sessions = [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, titles]) => ({ date, titles }));

  const count = sessions.reduce((s, d) => s + d.titles.length, 0);
  return { sessions, count };
}

// ── Synthesize ──

export function writeSynthesis(state: SynthesisState): string {
  const sp = synthesisPath();
  writeFileSync(sp, JSON.stringify(state, null, 2), "utf-8");
  return sp;
}

export function synthesize(days: number): SynthesisState {
  const since = daysAgo(days);
  const { sessions, count: sessionCount } = getRecentSessions(since);
  const ratings = getRatingStats(since);
  const algorithm = getAlgorithmStats(since);

  return {
    timestamp: new Date().toISOString(),
    days,
    sessions,
    sessionCount,
    ratings,
    algorithm,
  };
}

// ── CLI ──

function run() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      days: { type: "string", default: "7" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
Synthesize — Aggregate recent PAL activity into compact state

Usage:
  synthesize.ts [--days 7] [--force]

Options:
  --days   Lookback window (default: 7)
  --force  Skip 24h guard

Output: ~/.pal/memory/state/synthesis.json
`);
    process.exit(0);
  }

  const force = values.force ?? false;
  if (!shouldRun(force)) {
    console.log(
      JSON.stringify({
        skipped: true,
        message: "Last synthesis < 24h ago. Use --force to override.",
      })
    );
    return;
  }

  const days = parseInt(values.days ?? "7", 10);
  const state = synthesize(days);
  const sp = synthesisPath();

  writeFileSync(sp, JSON.stringify(state, null, 2), "utf-8");

  console.log(
    JSON.stringify(
      {
        success: true,
        path: sp,
        sessions: state.sessionCount,
        ratings: state.ratings.count,
        reflections: state.algorithm.reflectionCount,
        message: `Synthesis written (${days}-day window)`,
      },
      null,
      2
    )
  );
}

if (import.meta.main) run();
