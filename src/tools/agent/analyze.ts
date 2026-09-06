#!/usr/bin/env bun
/**
 * Unified Learning Analysis — graduation patterns + ratings summary.
 *
 * Reads failures and session learnings, finds recurring patterns,
 * summarizes ratings, and generates recommendations.
 *
 * What the report says is in lib/analyze-report.ts.
 *
 * Usage: bun run tool:analyze
 */

import { parseArgs } from "node:util";
import { writeLastAnalyzeDate } from "../../hooks/lib/analyze-nudge";
import { analyze } from "../../hooks/lib/graduation";
import { reportLines } from "../lib/analyze-report";

const HELP = `
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

  Usage: pal cli analyze [--actionable]
`;

export async function run(argv: string[] = Bun.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      actionable: { type: "boolean", short: "a" },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const result = await analyze({ actionable: values.actionable });
  for (const line of reportLines(result)) console.log(line);
  writeLastAnalyzeDate(new Date().toISOString());
}

if (import.meta.main) await run();
