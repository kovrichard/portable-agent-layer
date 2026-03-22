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
import { stringify } from "../hooks/lib/frontmatter";
import { HAIKU_MODEL } from "../hooks/lib/models";
import { palHome } from "../hooks/lib/paths";

// ── Paths ──

const RATINGS_FILE = resolve(palHome(), "memory", "signals", "ratings.jsonl");
const SYNTHESIS_DIR = resolve(palHome(), "memory", "learning", "synthesis");

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

async function generateRecommendations(
  frustrations: PatternGroup[],
  successes: PatternGroup[],
  avgRating: number
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || frustrations.length === 0) {
    // Fallback: generic recommendations
    if (frustrations.length === 0)
      return ["Continue current patterns - no major issues detected"];
    return frustrations
      .slice(0, 3)
      .map(
        (f) =>
          `Address "${f.pattern}" (${f.count} occurrences, avg ${f.avgRating.toFixed(1)}/10)`
      );
  }

  try {
    const context = [
      `Average rating: ${avgRating.toFixed(1)}/10`,
      "",
      "Top frustration patterns:",
      ...frustrations
        .slice(0, 5)
        .map(
          (f) =>
            `- ${f.pattern} (${f.count}x, avg ${f.avgRating.toFixed(1)}): ${f.examples.slice(0, 2).join("; ")}`
        ),
      "",
      successes.length > 0 ? "Success patterns:" : "",
      ...successes
        .slice(0, 3)
        .map((s) => `- ${s.pattern} (${s.count}x, avg ${s.avgRating.toFixed(1)})`),
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: context }],
        system:
          "You analyze AI assistant interaction patterns. Given frustration and success patterns from user ratings, generate 3-5 recommendations. Each MUST reference a specific example from the data — no generic advice like 'ask clarifying questions' or 'communicate better'. Every recommendation should name the concrete situation and the concrete fix. One sentence each. Return a JSON array of strings.",
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                recommendations: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["recommendations"],
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = (await response.json()) as { content?: Array<{ text?: string }> };
      const text = data?.content?.[0]?.text?.trim();
      if (text) {
        const parsed = JSON.parse(text) as { recommendations: string[] };
        if (parsed.recommendations?.length > 0) return parsed.recommendations.slice(0, 5);
      }
    }
  } catch {
    // Fallback silently
  }

  return frustrations
    .slice(0, 3)
    .map((f) => `Address "${f.pattern}" (${f.count} occurrences)`);
}

async function analyzeRatings(
  ratings: Rating[],
  period: string
): Promise<SynthesisResult> {
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

  const recommendations = await generateRecommendations(
    frustrations,
    successes,
    avgRating
  );

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

  const meta: Record<string, unknown> = {
    period: result.period,
    date,
    total_ratings: result.totalRatings,
    average_rating: result.avgRating.toFixed(1),
  };

  const lines: string[] = ["## Top Issues", ""];

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

  return stringify(meta, lines.join("\n"));
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

const result = await analyzeRatings(filtered, period);

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
