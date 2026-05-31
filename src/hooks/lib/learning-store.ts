/**
 * Learning Store — single collection layer for reading failures and session learnings.
 *
 * Both context.ts (session injection) and graduation.ts (pattern detection) read from
 * the same directories. This module provides a shared, deduplicated API for both.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "./frontmatter";

// ── Types ──

export interface FailureEntry {
  slug: string;
  path: string;
  rating: number;
  context: string;
  principle: string;
  date: string;
  ts: string;
  cwd: string;
}

export interface LearningEntry {
  filename: string;
  path: string;
  title: string;
  category: string;
  principle: string;
  date: string;
  insights: string;
  cwd: string;
}

// ── Shared Directory Walker ──

/**
 * Walk year/month directory structure in reverse chronological order.
 * Yields entries from the innermost directory (month level).
 */
function* walkMonthDirs(baseDir: string): Generator<{ monthDir: string }> {
  if (!existsSync(baseDir)) return;
  try {
    for (const year of readdirSync(baseDir).sort().reverse()) {
      const yearDir = resolve(baseDir, year);
      try {
        for (const month of readdirSync(yearDir).sort().reverse()) {
          yield { monthDir: resolve(yearDir, month) };
        }
      } catch {
        /* skip invalid year dirs */
      }
    }
  } catch {
    /* non-critical */
  }
}

// ── Failures ──

export function readFailures(baseDir: string, limit?: number): FailureEntry[] {
  const entries: FailureEntry[] = [];

  for (const { monthDir } of walkMonthDirs(baseDir)) {
    try {
      for (const slug of readdirSync(monthDir).sort().reverse()) {
        const capturePath = resolve(monthDir, slug, "capture.md");
        if (!existsSync(capturePath)) continue;

        try {
          const content = readFileSync(capturePath, "utf-8");
          const { meta } = parse<{
            rating?: number;
            context?: string;
            principle?: string;
            date?: string;
            ts?: string;
            slug?: string;
            cwd?: string;
          }>(content);

          if (!meta.context) continue;

          entries.push({
            slug: meta.slug || slug,
            path: capturePath,
            rating: meta.rating ?? 0,
            context: meta.context,
            principle: meta.principle || "",
            date: meta.date || (meta.ts ? String(meta.ts).slice(0, 10) : ""),
            ts: meta.ts ? String(meta.ts) : "",
            cwd: meta.cwd || "",
          });

          if (limit && entries.length >= limit) return entries;
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* skip invalid month dirs */
    }
  }

  return entries;
}

// ── Learnings ──

export function readLearnings(baseDir: string, limit?: number): LearningEntry[] {
  const entries: LearningEntry[] = [];

  for (const { monthDir } of walkMonthDirs(baseDir)) {
    try {
      const files = readdirSync(monthDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();

      for (const file of files) {
        try {
          const content = readFileSync(resolve(monthDir, file), "utf-8");
          const { meta, body } = parse<{
            title?: string;
            category?: string;
            principle?: string;
            date?: string;
            cwd?: string;
          }>(content);

          if (!meta.title) continue;

          const insightsMatch = new RegExp(/## Insights\n([\s\S]*?)(?=\n##|$)/).exec(
            body
          );

          entries.push({
            filename: file,
            path: resolve(monthDir, file),
            title: meta.title,
            category: meta.category || "algorithm",
            principle: meta.principle || "",
            date: meta.date || "",
            insights: insightsMatch?.[1]?.trim() || "",
            cwd: meta.cwd || "",
          });

          if (limit && entries.length >= limit) return entries;
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* skip invalid month dirs */
    }
  }

  return entries;
}

// ── Reflections ──

export interface ReflectionEntry {
  ts: string;
  cwd: string;
  task: string;
  sentiment: number;
  q1: string;
  q2: string;
  q3: string;
}

/**
 * Read algorithm reflections from the JSONL store, newest first. Each line is one
 * reflection produced at the end of an Algorithm run (q1 = what I'd do differently,
 * q2 = algorithm improvement, q3 = AI-level insight).
 */
export function readReflections(file: string, limit?: number): ReflectionEntry[] {
  if (!existsSync(file)) return [];
  const entries: ReflectionEntry[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      entries.push({
        ts: o.timestamp || "",
        cwd: o.cwd || "",
        task: o.task || "",
        sentiment: typeof o.sentiment === "number" ? o.sentiment : 0,
        q1: o.q1 || "",
        q2: o.q2 || "",
        q3: o.q3 || "",
      });
    } catch {
      /* skip malformed line */
    }
  }
  entries.reverse(); // JSONL is appended chronologically → newest first
  return limit ? entries.slice(0, limit) : entries;
}
