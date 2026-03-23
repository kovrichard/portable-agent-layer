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

// ── Text Similarity (Jaccard on keywords) ──

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "shall",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "no",
  "so",
  "if",
  "then",
  "than",
  "that",
  "this",
  "it",
  "its",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "what",
  "which",
  "who",
  "when",
  "where",
  "how",
  "all",
  "each",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "up",
  "out",
  "about",
  "just",
  "also",
  "very",
  "too",
  "only",
  "own",
]);

export function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

export function similarity(a: string, b: string): number {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.size === 0 || kb.size === 0) return 0;

  let intersection = 0;
  for (const w of ka) {
    if (kb.has(w)) intersection++;
  }
  const union = new Set([...ka, ...kb]).size;
  return union > 0 ? intersection / union : 0;
}
