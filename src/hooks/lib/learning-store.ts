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
  rating: number;
  context: string;
  principle: string;
  date: string;
  ts: string;
}

export interface LearningEntry {
  filename: string;
  title: string;
  category: string;
  principle: string;
  date: string;
  insights: string;
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
          }>(content);

          if (!meta.context) continue;

          entries.push({
            slug: meta.slug || slug,
            rating: meta.rating ?? 0,
            context: meta.context,
            principle: meta.principle || "",
            date: meta.date || (meta.ts ? String(meta.ts).slice(0, 10) : ""),
            ts: meta.ts ? String(meta.ts) : "",
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
          }>(content);

          if (!meta.title) continue;

          const insightsMatch = body.match(/## Insights\n([\s\S]*?)(?=\n##|$)/);

          entries.push({
            filename: file,
            title: meta.title,
            category: meta.category || "algorithm",
            principle: meta.principle || "",
            date: meta.date || "",
            insights: insightsMatch?.[1]?.trim() || "",
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
