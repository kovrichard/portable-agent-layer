#!/usr/bin/env bun
/**
 * Unified Learning Analysis — graduation patterns + ratings summary.
 *
 * Reads failures and session learnings, finds recurring patterns,
 * summarizes ratings, and generates recommendations.
 *
 * What the report says is in lib/analyze-report.ts.
 *
 * Usage: pal cli analyze [--actionable]
 */

import { writeLastAnalyzeDate } from "../../hooks/lib/analyze-nudge";
import { analyze } from "../../hooks/lib/graduation";
import { reportLines } from "../lib/analyze-report";
import { leaf, runCommand } from "../lib/command";
import { scriptArgs } from "../lib/script-args";

const DETAILS = `Reads all captured failures (rating ≤3),
groups recurring patterns via Dice similarity on context text,
and summarizes rating trends.

Sections:
  Ratings       Overall average, low/high counts
  Graduation    Patterns with 3+ occurrences → ready to crystallize
  Emerging      Patterns with 2 occurrences → one more to graduate

To crystallize a graduated pattern, record it as a standing opinion:
  pal cli rule add-opinion --kind <kind> --when "<situation>" --steering "<instruction>"`;

export const command = leaf({
  summary: "PAL Learning Analysis — unified graduation + ratings report",
  options: {
    actionable: {
      type: "boolean",
      short: "a",
      description: "Generate actionable recommendations via Haiku inference",
    },
  },
  details: DETAILS,
  run: ({ values }) => printAnalysis(values.actionable),
});

export function run(argv: string[] = scriptArgs()): Promise<number> {
  return runCommand(command, argv, ["pal", "cli", "analyze"]);
}

async function printAnalysis(actionable: boolean | undefined): Promise<undefined> {
  const result = await analyze({ actionable });
  for (const line of reportLines(result)) console.log(line);
  writeLastAnalyzeDate(new Date().toISOString());
}

if (import.meta.main) process.exit(await run());
