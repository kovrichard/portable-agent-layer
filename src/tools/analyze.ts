#!/usr/bin/env bun
/**
 * Unified Learning Analysis — graduation patterns + ratings summary.
 *
 * Reads failures and session learnings, finds recurring patterns,
 * summarizes ratings, and generates recommendations.
 *
 * Usage: bun run tool:analyze
 */

import { parseArgs } from "node:util";
import { analyze } from "../hooks/lib/graduation";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    actionable: { type: "boolean", short: "a" },
  },
});

if (values.help) {
  console.log(`
  PAL Learning Analysis — unified graduation + ratings report

  Reads all captured failures (rating ≤3) and session learnings,
  groups recurring patterns via Dice similarity on context text,
  and summarizes rating trends.

  Sections:
    Ratings       Overall average, low/high counts
    Graduation    Patterns with 3+ occurrences → ready to crystallize
    Emerging      Patterns with 2 occurrences → one more to graduate

  Flags:
    --actionable, -a  Generate actionable recommendations via Haiku inference

  To crystallize a graduated pattern, add it to the target wisdom frame:
    - Your principle here [CRYSTAL: 85%]

  Usage: bun run tool:analyze [--actionable] [--help]
`);
  process.exit(0);
}

const result = await analyze({ actionable: values.actionable });

const hasPatterns = result.candidates.length > 0 || result.emerging.length > 0;
const hasRatings = result.ratings !== null;

if (!hasPatterns && !hasRatings) {
  console.log("\n  No patterns or ratings data found.\n");
  process.exit(0);
}

// ── Ratings Summary ──

if (result.ratings) {
  const r = result.ratings;
  console.log(`\n  Ratings: ${r.average.toFixed(1)}/10 avg (${r.total} total)`);
  console.log(`  Low (≤4): ${r.low.count} | High (≥7): ${r.high.count}`);
}

// ── Graduation Candidates ──

if (result.candidates.length > 0) {
  console.log(
    `\n  Graduation Report — ${result.candidates.length} pattern(s) detected\n`
  );
  console.log("  ─────────────────────────────────────────────────\n");

  for (const candidate of result.candidates) {
    console.log(`  [${candidate.domain}] ${candidate.entries.length}x occurrences`);
    console.log("");

    for (const entry of candidate.entries) {
      const sourceType = entry.source.startsWith("failure:") ? "failure" : "learning";
      console.log(
        `    ${entry.date || "unknown"} [${sourceType}] ${entry.text.slice(0, 100)}`
      );
    }

    console.log("");
    console.log("  Target frame:", `memory/wisdom/frames/${candidate.domain}.md`);
    console.log("  ─────────────────────────────────────────────────\n");
  }
}

// ── Emerging Patterns ──

if (result.emerging.length > 0) {
  console.log(`  Emerging (2x — one more to graduate)\n`);
  for (const group of result.emerging) {
    console.log(`  [${group.domain}] ${group.entries.length}x`);
    for (const entry of group.entries) {
      const sourceType = entry.source.startsWith("failure:") ? "failure" : "learning";
      console.log(
        `    ${entry.date || "unknown"} [${sourceType}] ${entry.text.slice(0, 80)}`
      );
    }
    console.log("");
  }
}

// ── Recommendations ──

if (result.recommendations.length > 0) {
  console.log("  Recommendations:\n");
  for (const rec of result.recommendations) {
    console.log(`    ${rec}`);
  }
  console.log("");
}

if (result.candidates.length > 0) {
  console.log("  To crystallize: add a line to the wisdom frame file.");
  console.log("  Format: - Your principle here [CRYSTAL: 85%]\n");
}
