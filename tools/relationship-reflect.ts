#!/usr/bin/env bun
/**
 * RelationshipReflect — Periodic reflection on relationship patterns.
 *
 * Reads recent relationship notes and ratings to surface:
 * - Opinion confidence trends (which observations keep recurring?)
 * - Rating correlation (what interaction patterns correlate with low/high ratings?)
 * - Summary of the relationship state
 *
 * Usage:
 *   bun run tool:reflect              # Reflect on last 7 days
 *   bun run tool:reflect -- --month   # Reflect on last 30 days
 *   bun run tool:reflect -- --dry-run # Preview without writing
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

// ── Paths ──

function paiDir(): string {
  return process.env.PAI_DIR || resolve(import.meta.dir, "..");
}

const RATINGS_FILE = resolve(paiDir(), "memory", "signals", "ratings.jsonl");
const RELATIONSHIP_DIR = resolve(paiDir(), "memory", "relationship");
const REFLECTION_DIR = resolve(paiDir(), "memory", "relationship", "reflections");

// ── Types ──

interface Rating {
  ts: string;
  rating: number;
  context: string;
  source: "explicit" | "implicit";
}

interface ParsedNote {
  type: "W" | "O";
  text: string;
  confidence?: number;
  date: string;
  time: string;
}

interface ReflectionResult {
  period: string;
  totalNotes: number;
  totalRatings: number;
  avgRating: number;
  opinions: OpinionSummary[];
  worldFacts: string[];
  ratingCorrelation: string[];
}

interface OpinionSummary {
  text: string;
  occurrences: number;
  avgConfidence: number;
  dates: string[];
}

// ── Note Parsing ──

function loadNotes(daysBack: number): ParsedNote[] {
  if (!existsSync(RELATIONSHIP_DIR)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const notes: ParsedNote[] = [];

  for (const monthDir of readdirSync(RELATIONSHIP_DIR).sort().reverse()) {
    if (monthDir === "reflections") continue;
    const monthPath = resolve(RELATIONSHIP_DIR, monthDir);

    let files: string[];
    try {
      files = readdirSync(monthPath)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();
    } catch {
      continue;
    }

    for (const file of files) {
      const dateStr = file.replace(".md", "");
      if (new Date(dateStr) < cutoff) continue;

      try {
        const content = readFileSync(resolve(monthPath, file), "utf-8");
        let currentTime = "";

        for (const line of content.split("\n")) {
          const timeMatch = line.match(/^## (\d{2}:\d{2})/);
          if (timeMatch) {
            currentTime = timeMatch[1];
            continue;
          }

          // O(c=0.85): text
          const opinionMatch = line.match(/^- O\(c=([\d.]+)\):\s*(.+)$/);
          if (opinionMatch) {
            notes.push({
              type: "O",
              confidence: Number.parseFloat(opinionMatch[1]),
              text: opinionMatch[2],
              date: dateStr,
              time: currentTime,
            });
            continue;
          }

          // W: text
          const worldMatch = line.match(/^- W:\s*(.+)$/);
          if (worldMatch) {
            notes.push({
              type: "W",
              text: worldMatch[1],
              date: dateStr,
              time: currentTime,
            });
          }
        }
      } catch {
        // skip
      }
    }
  }

  return notes;
}

// ── Ratings ──

function loadRatings(daysBack: number): Rating[] {
  if (!existsSync(RATINGS_FILE)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  return readFileSync(RATINGS_FILE, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as Rating;
      } catch {
        return null;
      }
    })
    .filter(
      (r): r is Rating => r !== null && new Date(r.ts).getTime() >= cutoff.getTime()
    );
}

// ── Analysis ──

function groupOpinions(notes: ParsedNote[]): OpinionSummary[] {
  const opinions = notes.filter((n) => n.type === "O");
  const groups = new Map<string, { confidences: number[]; dates: string[] }>();

  for (const op of opinions) {
    // Normalize text for grouping (lowercase, trim)
    const key = op.text.toLowerCase().slice(0, 100);
    const existing = groups.get(key) ?? { confidences: [], dates: [] };
    if (op.confidence !== undefined) existing.confidences.push(op.confidence);
    existing.dates.push(op.date);
    groups.set(key, existing);
  }

  const summaries: OpinionSummary[] = [];
  for (const [, data] of groups) {
    const originalNote = opinions.find(
      (n) => n.text.toLowerCase().slice(0, 100) === [...groups.keys()][summaries.length]
    );
    const avgConf =
      data.confidences.length > 0
        ? data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length
        : 0;
    summaries.push({
      text: originalNote?.text ?? "",
      occurrences: data.dates.length,
      avgConfidence: avgConf,
      dates: [...new Set(data.dates)],
    });
  }

  return summaries.sort((a, b) => b.occurrences - a.occurrences);
}

function correlateRatings(ratings: Rating[]): string[] {
  const correlations: string[] = [];

  const lowRatings = ratings.filter((r) => r.rating <= 4);
  const highRatings = ratings.filter((r) => r.rating >= 7);

  if (lowRatings.length > 0) {
    correlations.push(
      `${lowRatings.length} low ratings (<=4) — common contexts: ${lowRatings
        .slice(0, 3)
        .map((r) => `"${r.context.slice(0, 60)}"`)
        .join(", ")}`
    );
  }
  if (highRatings.length > 0) {
    correlations.push(
      `${highRatings.length} high ratings (>=7) — common contexts: ${highRatings
        .slice(0, 3)
        .map((r) => `"${r.context.slice(0, 60)}"`)
        .join(", ")}`
    );
  }

  if (ratings.length > 0) {
    const explicitCount = ratings.filter((r) => r.source === "explicit").length;
    const implicitCount = ratings.filter((r) => r.source === "implicit").length;
    correlations.push(`Source mix: ${explicitCount} explicit, ${implicitCount} implicit`);
  }

  return correlations;
}

function analyze(
  notes: ParsedNote[],
  ratings: Rating[],
  period: string
): ReflectionResult {
  const avgRating =
    ratings.length > 0 ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : 0;

  return {
    period,
    totalNotes: notes.length,
    totalRatings: ratings.length,
    avgRating,
    opinions: groupOpinions(notes),
    worldFacts: notes
      .filter((n) => n.type === "W")
      .map((n) => n.text)
      .slice(0, 10),
    ratingCorrelation: correlateRatings(ratings),
  };
}

// ── Report ──

function formatReport(result: ReflectionResult): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    "# Relationship Reflection",
    "",
    `**Period:** ${result.period}`,
    `**Generated:** ${date}`,
    `**Notes analyzed:** ${result.totalNotes}`,
    `**Ratings analyzed:** ${result.totalRatings}`,
    `**Average Rating:** ${result.avgRating.toFixed(1)}/10`,
    "",
    "---",
    "",
  ];

  if (result.opinions.length > 0) {
    lines.push("## Recurring Opinions", "");
    for (const op of result.opinions) {
      lines.push(
        `- **${op.text}**`,
        `  Seen ${op.occurrences}x | Avg confidence: ${op.avgConfidence.toFixed(2)} | Dates: ${op.dates.join(", ")}`,
        ""
      );
    }
  }

  if (result.worldFacts.length > 0) {
    lines.push("## World Facts Observed", "");
    for (const fact of result.worldFacts) {
      lines.push(`- ${fact}`);
    }
    lines.push("");
  }

  if (result.ratingCorrelation.length > 0) {
    lines.push("## Rating Insights", "");
    for (const c of result.ratingCorrelation) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function writeReport(result: ReflectionResult, period: string): string {
  if (!existsSync(REFLECTION_DIR)) mkdirSync(REFLECTION_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const slug = period.toLowerCase().replace(/\s+/g, "-");
  const filename = `${date}_${slug}-reflection.md`;
  const filepath = resolve(REFLECTION_DIR, filename);

  writeFileSync(filepath, formatReport(result), "utf-8");
  return filepath;
}

// ── CLI ──

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    month: { type: "boolean" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`
RelationshipReflect — Periodic reflection on relationship patterns

Usage:
  bun run tool:reflect              Reflect on last 7 days (default)
  bun run tool:reflect -- --month   Reflect on last 30 days
  bun run tool:reflect -- --dry-run Preview without writing

Output: Creates reflection report in memory/relationship/reflections/
`);
  process.exit(0);
}

const daysBack = values.month ? 30 : 7;
const period = values.month ? "Monthly" : "Weekly";

const notes = loadNotes(daysBack);
const ratings = loadRatings(daysBack);

console.log(`Loaded ${notes.length} relationship notes from last ${daysBack} days`);
console.log(`Loaded ${ratings.length} ratings from last ${daysBack} days`);

if (notes.length === 0 && ratings.length === 0) {
  console.log("No data to analyze");
  process.exit(0);
}

const result = analyze(notes, ratings, period);

console.log(`\nAverage Rating: ${result.avgRating.toFixed(1)}/10`);
console.log(`Opinions tracked: ${result.opinions.length}`);
console.log(`World facts: ${result.worldFacts.length}`);

if (result.opinions.length > 0) {
  console.log("\nTop recurring opinions:");
  for (const op of result.opinions.slice(0, 5)) {
    console.log(
      `  - [${op.occurrences}x, c=${op.avgConfidence.toFixed(2)}] ${op.text.slice(0, 80)}`
    );
  }
}

if (values["dry-run"]) {
  console.log("\n[DRY RUN] Would write reflection report");
} else {
  const filepath = writeReport(result, period);
  console.log(`\nCreated reflection report: ${filepath}`);
}
