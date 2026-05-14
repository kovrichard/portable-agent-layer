#!/usr/bin/env bun
/**
 * RelationshipReflect — Periodic reflection on relationship patterns.
 *
 * Reads recent relationship notes and ratings to:
 * - Promote recurring O notes into tracked opinions with confidence
 * - Update confidence on existing opinions via supporting evidence
 * - Generate a summary report
 *
 * Usage:
 *   bun run tool:reflect              # Reflect on last 7 days
 *   bun run tool:reflect -- --month   # Reflect on last 30 days
 *   bun run tool:reflect -- --dry-run # Preview without writing
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  addEvidence,
  createOpinion,
  findSimilarOpinion,
  readOpinions,
  saveOpinion,
  setLastReflectDate,
} from "../hooks/lib/opinions";
import { palHome } from "../hooks/lib/paths";
import { similarity } from "../hooks/lib/text-similarity";

// ── Types ──

interface Rating {
  ts: string;
  rating: number;
  context: string;
  source: "explicit" | "implicit";
}

interface ParsedNote {
  type: "W" | "O" | "Session";
  text: string;
  confidence?: number;
  date: string;
  time: string;
}

interface OpinionChange {
  statement: string;
  action: "created" | "strengthened";
  oldConfidence?: number;
  newConfidence: number;
}

// ── Note Parsing ──

export function loadNotes(daysBack: number): ParsedNote[] {
  const relationshipDir = resolve(palHome(), "memory", "relationship");
  if (!existsSync(relationshipDir)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const notes: ParsedNote[] = [];

  for (const monthDir of readdirSync(relationshipDir).sort().reverse()) {
    if (!/^\d{4}-\d{2}$/.test(monthDir)) continue;
    const monthPath = resolve(relationshipDir, monthDir);

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

          // O(c=0.85): text or B(c=0.85): text
          const obMatch = line.match(/^- ([OB])\(c=([\d.]+)\):\s*(.+)$/);
          if (obMatch) {
            notes.push({
              type: obMatch[1] as "O" | "Session",
              confidence: Number.parseFloat(obMatch[2]),
              text: obMatch[3],
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

export function loadRatings(daysBack: number): Rating[] {
  const ratingsFile = resolve(palHome(), "memory", "signals", "ratings.jsonl");
  if (!existsSync(ratingsFile)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  return readFileSync(ratingsFile, "utf-8")
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

// ── Opinion Promotion ──

export function promoteToOpinions(notes: ParsedNote[], dryRun: boolean): OpinionChange[] {
  const changes: OpinionChange[] = [];
  const opinions = readOpinions();

  const opinionNotes = notes.filter((n) => n.type === "O");

  // Group similar notes together
  const groups = new Map<string, ParsedNote[]>();
  for (const note of opinionNotes) {
    let matched = false;
    for (const [key, group] of groups) {
      if (similarity(note.text, key) >= 0.3) {
        group.push(note);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.set(note.text, [note]);
    }
  }

  for (const [representative, group] of groups) {
    const existing = findSimilarOpinion(representative, opinions);

    if (existing) {
      let updated = existing;
      for (const note of group) {
        updated = addEvidence(updated, "supporting", note.text.slice(0, 120));
      }

      if (updated.confidence !== existing.confidence) {
        changes.push({
          statement: existing.statement,
          action: "strengthened",
          oldConfidence: existing.confidence,
          newConfidence: updated.confidence,
        });
        if (!dryRun) saveOpinion(updated);
      }
    } else if (group.length >= 2) {
      let opinion = createOpinion(representative, group[0].text.slice(0, 120));
      for (const note of group.slice(1)) {
        opinion = addEvidence(opinion, "supporting", note.text.slice(0, 120));
      }
      changes.push({
        statement: representative,
        action: "created",
        newConfidence: opinion.confidence,
      });
      if (!dryRun) saveOpinion(opinion);
    }
  }

  return changes;
}

// ── Analysis ──

interface OpinionSummary {
  text: string;
  occurrences: number;
  avgConfidence: number;
  dates: string[];
}

export function groupNoteOccurrences(notes: ParsedNote[]): OpinionSummary[] {
  const opNotes = notes.filter((n) => n.type === "O");
  const groups = new Map<
    string,
    { confidences: number[]; dates: string[]; text: string }
  >();

  for (const note of opNotes) {
    let matched = false;
    for (const [key, group] of groups) {
      if (similarity(note.text, key) >= 0.3) {
        if (note.confidence !== undefined) group.confidences.push(note.confidence);
        group.dates.push(note.date);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.set(note.text, {
        text: note.text,
        confidences: note.confidence !== undefined ? [note.confidence] : [],
        dates: [note.date],
      });
    }
  }

  return [...groups.values()]
    .map((g) => ({
      text: g.text,
      occurrences: g.dates.length,
      avgConfidence:
        g.confidences.length > 0
          ? g.confidences.reduce((a, b) => a + b, 0) / g.confidences.length
          : 0,
      dates: [...new Set(g.dates)],
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

function correlateRatings(ratings: Rating[]): string[] {
  const correlations: string[] = [];

  const lowRatings = ratings.filter((r) => r.rating <= 4);
  const highRatings = ratings.filter((r) => r.rating >= 7);

  if (lowRatings.length > 0) {
    const lowContexts = lowRatings
      .slice(0, 3)
      .map((r) => `"${r.context.slice(0, 60)}"`)
      .join(", ");
    correlations.push(
      `${lowRatings.length} low ratings (<=4) — common contexts: ${lowContexts}`
    );
  }
  if (highRatings.length > 0) {
    const highContexts = highRatings
      .slice(0, 3)
      .map((r) => `"${r.context.slice(0, 60)}"`)
      .join(", ");
    correlations.push(
      `${highRatings.length} high ratings (>=7) — common contexts: ${highContexts}`
    );
  }

  if (ratings.length > 0) {
    const explicitCount = ratings.filter((r) => r.source === "explicit").length;
    const implicitCount = ratings.filter((r) => r.source === "implicit").length;
    correlations.push(`Source mix: ${explicitCount} explicit, ${implicitCount} implicit`);
  }

  return correlations;
}

// ── Report ──

export function formatReport(
  period: string,
  notes: ParsedNote[],
  ratings: Rating[],
  opinionChanges: OpinionChange[]
): string {
  const date = new Date().toISOString().slice(0, 10);
  const avgRating =
    ratings.length > 0 ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : 0;
  const summaries = groupNoteOccurrences(notes);
  const worldFacts = notes.filter((n) => n.type === "W").map((n) => n.text);
  const ratingInsights = correlateRatings(ratings);

  const lines: string[] = [
    "# Relationship Reflection",
    "",
    `**Period:** ${period}`,
    `**Generated:** ${date}`,
    `**Notes analyzed:** ${notes.length}`,
    `**Ratings analyzed:** ${ratings.length}`,
    `**Average Rating:** ${avgRating.toFixed(1)}/10`,
    "",
    "---",
    "",
  ];

  if (opinionChanges.length > 0) {
    lines.push("## Opinion Changes", "");
    for (const change of opinionChanges) {
      if (change.action === "created") {
        lines.push(
          `- **NEW** (${Math.round(change.newConfidence * 100)}%): ${change.statement}`
        );
      } else {
        lines.push(
          `- **+** ${Math.round(change.oldConfidence ?? 0 * 100)}% → ${Math.round(change.newConfidence * 100)}%: ${change.statement}`
        );
      }
    }
    lines.push("");
  }

  if (summaries.length > 0) {
    lines.push("## Recurring Opinions", "");
    for (const op of summaries) {
      lines.push(
        `- **${op.text}**`,
        `  Seen ${op.occurrences}x | Avg confidence: ${op.avgConfidence.toFixed(2)} | Dates: ${op.dates.join(", ")}`,
        ""
      );
    }
  }

  if (worldFacts.length > 0) {
    lines.push("## World Facts Observed", "");
    for (const fact of worldFacts.slice(0, 10)) {
      lines.push(`- ${fact}`);
    }
    lines.push("");
  }

  if (ratingInsights.length > 0) {
    lines.push("## Rating Insights", "");
    for (const insight of ratingInsights) {
      lines.push(`- ${insight}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function writeReport(report: string, period: string): string {
  const reflectionDir = resolve(palHome(), "memory", "relationship", "reflections");
  if (!existsSync(reflectionDir)) mkdirSync(reflectionDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const slug = period.toLowerCase().replace(/\s+/g, "-");
  const filename = `${date}_${slug}-reflection.md`;
  const filepath = resolve(reflectionDir, filename);

  writeFileSync(filepath, report, "utf-8");
  return filepath;
}

// ── CLI ──

function run() {
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
RelationshipReflect — Periodic reflection + opinion promotion

Reads recent relationship notes and ratings. Promotes recurring
observations (O type) into tracked opinions with confidence scoring.

Usage:
  bun run tool:reflect              Reflect on last 7 days (default)
  bun run tool:reflect -- --month   Reflect on last 30 days
  bun run tool:reflect -- --dry-run Preview without writing

Output:
  - Updates memory/relationship/opinions.json (confidence tracking)
  - Creates reflection report in memory/relationship/reflections/
`);
    process.exit(0);
  }

  const daysBack = values.month ? 30 : 7;
  const period = values.month ? "Monthly" : "Weekly";
  const dryRun = values["dry-run"] ?? false;

  const notes = loadNotes(daysBack);
  const ratings = loadRatings(daysBack);

  console.log(`Loaded ${notes.length} notes from last ${daysBack} days`);
  console.log(`Loaded ${ratings.length} ratings`);

  if (notes.length === 0 && ratings.length === 0) {
    console.log("No data to analyze");
    process.exit(0);
  }

  const opinionChanges = promoteToOpinions(notes, dryRun);

  const avgRating =
    ratings.length > 0 ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : 0;
  console.log(`\nAverage Rating: ${avgRating.toFixed(1)}/10`);

  const summaries = groupNoteOccurrences(notes);
  console.log(`Observations: ${summaries.length} unique`);

  if (opinionChanges.length > 0) {
    console.log("\nOpinion changes:");
    for (const change of opinionChanges) {
      if (change.action === "created") {
        console.log(
          `  + NEW (${Math.round(change.newConfidence * 100)}%) ${change.statement.slice(0, 80)}`
        );
      } else {
        console.log(
          `  ~ ${Math.round(change.oldConfidence ?? 0 * 100)}% → ${Math.round(change.newConfidence * 100)}% ${change.statement.slice(0, 80)}`
        );
      }
    }
  } else {
    console.log("\nNo opinion changes");
  }

  if (dryRun) {
    console.log("\n[DRY RUN] Would write reflection report + update opinions");
  } else {
    const report = formatReport(period, notes, ratings, opinionChanges);
    const filepath = writeReport(report, period);
    setLastReflectDate(new Date().toISOString().slice(0, 10));
    console.log(`\nCreated reflection report: ${filepath}`);

    const opinions = readOpinions();
    const high = opinions.filter((o) => o.confidence >= 0.85);
    if (high.length > 0) {
      console.log("\nHigh-confidence opinions (injected into context):");
      for (const o of high) {
        console.log(`  [${Math.round(o.confidence * 100)}%] ${o.statement.slice(0, 80)}`);
      }
    }
  }
}

if (import.meta.main) run();
