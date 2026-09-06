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

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { readOpinions, saveOpinion, setLastReflectDate } from "../hooks/lib/opinions";
import { palHome } from "../hooks/lib/paths";
import { emit } from "./lib/emit";
import {
  consoleLines,
  formatReport,
  highConfidenceLines,
  loadNotes,
  loadRatings,
  planPromotions,
  reportPath,
} from "./lib/relationship-reflect";

const HELP = `
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
`;

const relationshipDir = () => resolve(palHome(), "memory", "relationship");
const ratingsFile = () => resolve(palHome(), "memory", "signals", "ratings.jsonl");

function saveReport(report: string, period: string): string {
  const dir = resolve(relationshipDir(), "reflections");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filepath = reportPath(dir, period);
  writeFileSync(filepath, report, "utf-8");
  return filepath;
}

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
    console.log(HELP);
    process.exit(0);
  }

  const daysBack = values.month ? 30 : 7;
  const period = values.month ? "Monthly" : "Weekly";
  const dryRun = values["dry-run"] ?? false;

  const notes = loadNotes(relationshipDir(), daysBack);
  const ratings = loadRatings(ratingsFile(), daysBack);

  emit.ok(`Loaded ${notes.length} notes from last ${daysBack} days`);
  emit.ok(`Loaded ${ratings.length} ratings`);

  if (notes.length === 0 && ratings.length === 0) {
    emit.ok("No data to analyze");
    process.exit(0);
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

if (import.meta.main) run();
