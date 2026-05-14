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
import { type AnalysisResult, analyze } from "../../hooks/lib/graduation";

// ── ANSI Colors ──

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
};

export function printReport(result: AnalysisResult): void {
  const hasPatterns = result.candidates.length > 0 || result.emerging.length > 0;
  const hasRatings = result.ratings !== null;

  if (!hasPatterns && !hasRatings) {
    console.log("\n  No patterns or ratings data found.\n");
    return;
  }

  if (result.ratings) {
    const r = result.ratings;
    const lowOrMid = r.average <= 4 ? c.red : c.yellow;
    const avgColor = r.average >= 7 ? c.green : lowOrMid;
    const ratingStr = `${r.average.toFixed(1)}/10`;
    const lowStr = `Low (≤4): ${r.low.count}`;
    const highStr = `High (≥7): ${r.high.count}`;
    console.log(
      `\n  ${c.bold("Ratings:")} ${avgColor(ratingStr)} avg (${r.total} total)`
    );
    console.log(`  ${c.red(lowStr)} | ${c.green(highStr)}`);
  }

  if (result.candidates.length > 0) {
    const graduationHeader = `Graduation Report — ${result.candidates.length} pattern(s) detected`;
    console.log(`\n  ${c.bold(c.green(graduationHeader))}\n`);
    console.log(`  ${c.dim("─────────────────────────────────────────────────")}\n`);

    for (const candidate of result.candidates) {
      const domain = `[${candidate.domain}]`;
      const count = `${candidate.entries.length}x`;
      console.log(`  ${c.cyan(domain)} ${c.bold(count)} occurrences`);
      console.log("");

      for (const entry of candidate.entries) {
        const sourceType = entry.source.startsWith("failure:") ? "failure" : "learning";
        const tag =
          sourceType === "failure"
            ? c.red(`[${sourceType}]`)
            : c.yellow(`[${sourceType}]`);
        console.log(
          `    ${c.dim(entry.date || "unknown")} ${tag} ${entry.text.slice(0, 100)}`
        );
      }

      console.log(`\n  ${c.dim("Files:")}`);
      for (const entry of candidate.entries) {
        console.log(`    ${c.dim(entry.path)}`);
      }

      console.log("");
      const framePath = `memory/wisdom/frames/${candidate.domain}.md`;
      console.log(`  Target frame: ${c.magenta(framePath)}`);
      console.log(`  ${c.dim("─────────────────────────────────────────────────")}\n`);
    }
  }

  if (result.emerging.length > 0) {
    console.log(`  ${c.bold(c.yellow("Emerging (2x — one more to graduate)"))}\n`);
    for (const group of result.emerging) {
      const domain = `[${group.domain}]`;
      const count = `${group.entries.length}x`;
      console.log(`  ${c.cyan(domain)} ${c.bold(count)}`);
      for (const entry of group.entries) {
        const sourceType = entry.source.startsWith("failure:") ? "failure" : "learning";
        const tag =
          sourceType === "failure"
            ? c.red(`[${sourceType}]`)
            : c.yellow(`[${sourceType}]`);
        console.log(
          `    ${c.dim(entry.date || "unknown")} ${tag} ${entry.text.slice(0, 80)}`
        );
      }
      console.log("  Files:");
      for (const entry of group.entries) {
        console.log(`    ${c.dim(entry.path)}`);
      }
      console.log("");
    }
  }

  if (result.recommendations.length > 0) {
    console.log(`  ${c.bold("Recommendations:")}\n`);
    for (const rec of result.recommendations) {
      console.log(`    ${rec}`);
    }
    console.log("");
  }

  if (result.candidates.length > 0) {
    console.log(`  To crystallize: add a line to the wisdom frame file.`);
    console.log(`  Format: ${c.green("- Your principle here [CRYSTAL: 85%]")}\n`);
  }
}

async function run() {
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
  printReport(result);
}

if (import.meta.main) await run();
