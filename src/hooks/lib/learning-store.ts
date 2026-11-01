/**
 * Learning Store — reads the failure captures and algorithm reflections on disk.
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
    for (const slug of newestFirstEntries(monthDir)) {
      const entry = readCapture(resolve(monthDir, slug, "capture.md"), slug);
      if (!entry) continue;
      entries.push(entry);
      if (limit && entries.length >= limit) return entries;
    }
  }

  return entries;
}

function newestFirstEntries(dir: string): string[] {
  try {
    return readdirSync(dir).sort().reverse();
  } catch {
    return [];
  }
}

/** Null when the capture is missing, malformed or has no context. */
function readCapture(capturePath: string, slug: string): FailureEntry | null {
  if (!existsSync(capturePath)) return null;
  try {
    const { meta } = parse<{
      rating?: number;
      context?: string;
      principle?: string;
      date?: string;
      ts?: string;
      slug?: string;
      cwd?: string;
    }>(readFileSync(capturePath, "utf-8"));
    if (!meta.context) return null;
    return {
      slug: meta.slug || slug,
      path: capturePath,
      rating: meta.rating ?? 0,
      context: meta.context,
      principle: meta.principle || "",
      date: meta.date || (meta.ts ? String(meta.ts).slice(0, 10) : ""),
      ts: meta.ts ? String(meta.ts) : "",
      cwd: meta.cwd || "",
    };
  } catch {
    return null;
  }
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
  /** Whether the improvement ideas generalize to the algorithm, or are task-bound. */
  scope: "general" | "task-specific";
}

/**
 * Read algorithm reflections from the JSONL store, newest first. Each line is one
 * reflection produced at the end of an Algorithm run (q1 = what I'd do differently,
 * q2 = algorithm improvement, q3 = AI-level insight).
 */
function reflectionOf(o: ReturnType<typeof JSON.parse>): ReflectionEntry {
  return {
    ts: o.timestamp || "",
    cwd: o.cwd || "",
    task: o.task || "",
    sentiment: typeof o.sentiment === "number" ? o.sentiment : 0,
    q1: o.q1 || "",
    q2: o.q2 || "",
    q3: o.q3 || "",
    // Untagged (e.g. the existing backlog) defaults to general — the common case.
    scope: o.scope === "task-specific" ? "task-specific" : "general",
  };
}

export function readReflections(file: string, limit?: number): ReflectionEntry[] {
  if (!existsSync(file)) return [];
  const entries: ReflectionEntry[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(reflectionOf(JSON.parse(line)));
    } catch {
      /* skip malformed line */
    }
  }
  entries.reverse(); // JSONL is appended chronologically → newest first
  return limit ? entries.slice(0, limit) : entries;
}
