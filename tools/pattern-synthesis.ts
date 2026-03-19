#!/usr/bin/env bun
/**
 * LearningPatternSynthesis — Aggregate ratings into actionable patterns.
 *
 * Analyzes memory/signals/ratings.jsonl to find recurring frustration/success
 * patterns and generates synthesis reports.
 *
 * Usage:
 *   bun run tool:patterns              # Analyze last 7 days (default)
 *   bun run tool:patterns -- --month   # Analyze last 30 days
 *   bun run tool:patterns -- --all     # Analyze all ratings
 *   bun run tool:patterns -- --dry-run # Preview without writing
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

// ── Paths ──

function paiDir(): string {
  return process.env.PAI_DIR || resolve(import.meta.dir, "..");
}

const RATINGS_FILE = resolve(paiDir(), "memory", "signals", "ratings.jsonl");
const SYNTHESIS_DIR = resolve(paiDir(), "memory", "learning", "synthesis");

// ── Types ──

interface Rating {
  ts: string;
  rating: number;
  context: string;
  source: "explicit" | "implicit";
  response_preview?: string;
}

interface PatternGroup {
  pattern: string;
  count: number;
  avgRating: number;
  examples: string[];
}

interface SynthesisResult {
  period: string;
  totalRatings: number;
  avgRating: number;
  frustrations: PatternGroup[];
  successes: PatternGroup[];
  topIssues: string[];
  recommendations: string[];
}

// ── Pattern Detection ──

const FRUSTRATION_PATTERNS: Record<string, RegExp> = {
  "Time/Performance Issues": /time|slow|delay|hang|wait|long|minutes|hours/i,
  "Incomplete Work": /incomplete|missing|partial|didn't finish|not done/i,
  "Wrong Approach": /wrong|incorrect|not what|misunderstand|mistake/i,
  "Over-engineering": /over-?engineer|too complex|unnecessary|bloat/i,
  "Tool/System Failures": /fail|error|broken|crash|bug|issue/i,
  "Communication Problems": /unclear|confus|didn't ask|should have asked/i,
  "Repetitive Issues": /again|repeat|still|same problem/i,
};

const SUCCESS_PATTERNS: Record<string, RegExp> = {
  "Quick Resolution": /quick|fast|efficient|smooth/i,
  "Good Understanding": /understood|clear|exactly|perfect/i,
  "Proactive Help": /proactive|anticipat|helpful|above and beyond/i,
  "Clean Implementation": /clean|simple|elegant|well done/i,
};

function detectPatterns(
  summaries: string[],
  patterns: Record<string, RegExp>
): Map<string, string[]> {
  const results = new Map<string, string[]>();
  for (const summary of summaries) {
    for (const [name, pattern] of Object.entries(patterns)) {
      if (pattern.test(summary)) {
        const arr = results.get(name) ?? [];
        arr.push(summary);
        results.set(name, arr);
      }
    }
  }
  return results;
}

function toPatternGroups(
  grouped: Map<string, string[]>,
  ratings: Rating[]
): PatternGroup[] {
  const groups: PatternGroup[] = [];

  for (const [pattern, examples] of grouped.entries()) {
    const matching = ratings.filter((r) => examples.some((e) => e === r.context));
    const avgRating =
      matching.length > 0
        ? matching.reduce((sum, r) => sum + r.rating, 0) / matching.length
        : 5;

    groups.push({
      pattern,
      count: examples.length,
      avgRating,
      examples: examples.slice(0, 3),
    });
  }

  return groups.sort((a, b) => b.count - a.count);
}

// ── Analysis ──

function analyzeRatings(ratings: Rating[], period: string): SynthesisResult {
  if (ratings.length === 0) {
    return {
      period,
      totalRatings: 0,
      avgRating: 0,
      frustrations: [],
      successes: [],
      topIssues: [],
      recommendations: [],
    };
  }

  const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;

  const frustrationRatings = ratings.filter((r) => r.rating <= 4);
  const successRatings = ratings.filter((r) => r.rating >= 7);

  const frustrationGroups = detectPatterns(
    frustrationRatings.map((r) => r.context),
    FRUSTRATION_PATTERNS
  );
  const successGroups = detectPatterns(
    successRatings.map((r) => r.context),
    SUCCESS_PATTERNS
  );

  const frustrations = toPatternGroups(frustrationGroups, frustrationRatings);
  const successes = toPatternGroups(successGroups, successRatings);

  const topIssues = frustrations
    .slice(0, 3)
    .map(
      (f) => `${f.pattern} (${f.count} occurrences, avg rating ${f.avgRating.toFixed(1)})`
    );

  const recommendations: string[] = [];
  if (frustrations.some((f) => f.pattern === "Time/Performance Issues")) {
    recommendations.push(
      "Consider setting clearer time expectations and progress updates"
    );
  }
  if (frustrations.some((f) => f.pattern === "Wrong Approach")) {
    recommendations.push("Ask clarifying questions before starting complex tasks");
  }
  if (frustrations.some((f) => f.pattern === "Over-engineering")) {
    recommendations.push(
      "Default to simpler solutions; only add complexity when justified"
    );
  }
  if (frustrations.some((f) => f.pattern === "Communication Problems")) {
    recommendations.push("Summarize understanding before implementation");
  }
  if (recommendations.length === 0) {
    recommendations.push("Continue current patterns - no major issues detected");
  }

  return {
    period,
    totalRatings: ratings.length,
    avgRating,
    frustrations,
    successes,
    topIssues,
    recommendations,
  };
}

// ── Report ──

function formatReport(result: SynthesisResult): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    "# Learning Pattern Synthesis",
    "",
    `**Period:** ${result.period}`,
    `**Generated:** ${date}`,
    `**Total Ratings:** ${result.totalRatings}`,
    `**Average Rating:** ${result.avgRating.toFixed(1)}/10`,
    "",
    "---",
    "",
    "## Top Issues",
    "",
  ];

  if (result.topIssues.length > 0) {
    for (let i = 0; i < result.topIssues.length; i++) {
      lines.push(`${i + 1}. ${result.topIssues[i]}`);
    }
  } else {
    lines.push("No significant issues detected");
  }

  lines.push("", "## Frustration Patterns", "");
  if (result.frustrations.length === 0) {
    lines.push("*No frustration patterns detected*");
  } else {
    for (const f of result.frustrations) {
      lines.push(
        `### ${f.pattern}`,
        "",
        `- **Occurrences:** ${f.count}`,
        `- **Avg Rating:** ${f.avgRating.toFixed(1)}`,
        `- **Examples:**`,
        ...f.examples.map((e) => `  - "${e}"`),
        ""
      );
    }
  }

  lines.push("", "## Success Patterns", "");
  if (result.successes.length === 0) {
    lines.push("*No success patterns detected*");
  } else {
    for (const s of result.successes) {
      lines.push(
        `### ${s.pattern}`,
        "",
        `- **Occurrences:** ${s.count}`,
        `- **Avg Rating:** ${s.avgRating.toFixed(1)}`,
        `- **Examples:**`,
        ...s.examples.map((e) => `  - "${e}"`),
        ""
      );
    }
  }

  lines.push(
    "",
    "## Recommendations",
    "",
    ...result.recommendations.map((r, i) => `${i + 1}. ${r}`),
    ""
  );

  return lines.join("\n");
}

function writeReport(result: SynthesisResult, period: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const monthDir = resolve(SYNTHESIS_DIR, date.slice(0, 7));
  if (!existsSync(monthDir)) mkdirSync(monthDir, { recursive: true });

  const slug = period.toLowerCase().replace(/\s+/g, "-");
  const filename = `${date}_${slug}-patterns.md`;
  const filepath = resolve(monthDir, filename);

  writeFileSync(filepath, formatReport(result), "utf-8");
  return filepath;
}

// ── CLI ──

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    week: { type: "boolean" },
    month: { type: "boolean" },
    all: { type: "boolean" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`
LearningPatternSynthesis — Aggregate ratings into actionable patterns

Usage:
  bun run tool:patterns              Analyze last 7 days (default)
  bun run tool:patterns -- --month   Analyze last 30 days
  bun run tool:patterns -- --all     Analyze all ratings
  bun run tool:patterns -- --dry-run Preview without writing

Output: Creates synthesis report in memory/learning/synthesis/YYYY-MM/
`);
  process.exit(0);
}

if (!existsSync(RATINGS_FILE)) {
  console.log("No ratings file found at:", RATINGS_FILE);
  process.exit(0);
}

// Read ratings
const allRatings: Rating[] = readFileSync(RATINGS_FILE, "utf-8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter((r): r is Rating => r !== null);

console.log(`Loaded ${allRatings.length} total ratings`);

// Determine period
let period = "Weekly";
const cutoff = new Date();

if (values.month) {
  period = "Monthly";
  cutoff.setDate(cutoff.getDate() - 30);
} else if (values.all) {
  period = "All Time";
  cutoff.setTime(0);
} else {
  cutoff.setDate(cutoff.getDate() - 7);
}

const filtered = allRatings.filter((r) => new Date(r.ts).getTime() >= cutoff.getTime());
console.log(`Analyzing ${filtered.length} ratings for ${period.toLowerCase()} period`);

if (filtered.length === 0) {
  console.log("No ratings in this period");
  process.exit(0);
}

const result = analyzeRatings(filtered, period);

console.log(`\nAverage Rating: ${result.avgRating.toFixed(1)}/10`);
console.log(`Frustration Patterns: ${result.frustrations.length}`);
console.log(`Success Patterns: ${result.successes.length}`);

if (result.topIssues.length > 0) {
  console.log("\nTop Issues:");
  for (const issue of result.topIssues) {
    console.log(`  - ${issue}`);
  }
}

if (values["dry-run"]) {
  console.log("\n[DRY RUN] Would write synthesis report");
  console.log("\nRecommendations:");
  for (const rec of result.recommendations) {
    console.log(`  - ${rec}`);
  }
} else {
  const filepath = writeReport(result, period);
  console.log(`\nCreated synthesis report: ${filepath}`);
}
