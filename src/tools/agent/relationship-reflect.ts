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
 *   pal cli relationship-reflect             # Reflect on last 7 days
 *   pal cli relationship-reflect --month     # Reflect on last 30 days
 *   pal cli relationship-reflect --dry-run   # Preview without writing
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readOpinions, saveOpinion, setLastReflectDate } from "../../hooks/lib/opinions";
import { palHome } from "../../hooks/lib/paths";
import { leaf, runCommand } from "../lib/command";
import { emit } from "../lib/emit";
import {
  consoleLines,
  formatReport,
  highConfidenceLines,
  loadNotes,
  loadRatings,
  planPromotions,
  reportPath,
} from "../lib/relationship-reflect";
import { scriptArgs } from "../lib/script-args";

const DETAILS = `Reads recent relationship notes and ratings. Promotes recurring
observations (O type) into tracked opinions with confidence scoring.
With no flags, reflects on the last 7 days.

Output:
  - Updates memory/relationship/opinions.json (confidence tracking)
  - Creates reflection report in memory/relationship/reflections/`;

export const command = leaf({
  summary: "Periodic reflection + opinion promotion",
  options: {
    month: { type: "boolean", description: "Reflect on last 30 days" },
    "dry-run": { type: "boolean", description: "Preview without writing" },
  },
  details: DETAILS,
  run: ({ values }) => reflect(values.month ?? false, values["dry-run"] ?? false),
});

export function run(argv: string[] = scriptArgs()): Promise<number> {
  return runCommand(command, argv, ["pal", "cli", "relationship-reflect"]);
}

const relationshipDir = () => resolve(palHome(), "memory", "relationship");
const ratingsFile = () => resolve(palHome(), "memory", "signals", "ratings.jsonl");

function saveReport(report: string, period: string): string {
  const dir = resolve(relationshipDir(), "reflections");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filepath = reportPath(dir, period);
  writeFileSync(filepath, report, "utf-8");
  return filepath;
}

function reflect(month: boolean, dryRun: boolean): undefined {
  const daysBack = month ? 30 : 7;
  const period = month ? "Monthly" : "Weekly";

  const notes = loadNotes(relationshipDir(), daysBack);
  const ratings = loadRatings(ratingsFile(), daysBack);

  emit.ok(`Loaded ${notes.length} notes from last ${daysBack} days`);
  emit.ok(`Loaded ${ratings.length} ratings`);

  if (notes.length === 0 && ratings.length === 0) {
    emit.ok("No data to analyze");
    return;
  }

  const plan = planPromotions(notes, readOpinions());
  if (!dryRun) for (const opinion of plan.toSave) saveOpinion(opinion);

  for (const line of consoleLines(notes, ratings, plan.changes)) emit.ok(line);

  if (dryRun) {
    emit.data("[DRY RUN] Would write reflection report + update opinions");
    return;
  }

  const filepath = saveReport(formatReport(period, notes, ratings, plan.changes), period);
  setLastReflectDate(new Date().toISOString().slice(0, 10));
  emit.receipt(filepath, {
    period,
    notes: notes.length,
    ratings: ratings.length,
    opinionChanges: plan.changes.length,
  });

  for (const line of highConfidenceLines(readOpinions())) emit.ok(line);
}

if (import.meta.main) process.exit(await run());
