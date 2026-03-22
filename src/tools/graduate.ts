#!/usr/bin/env bun
/**
 * Wisdom Graduation — promote recurring patterns into permanent wisdom frames.
 *
 * Reads failures and session learnings, finds patterns that recur 3+ times,
 * and graduates them into wisdom frames with confidence tracking.
 *
 * Usage:
 *   bun run tool:graduate              # Run graduation
 *   bun run tool:graduate -- --dry-run # Preview without writing
 */

import { graduate } from "../hooks/lib/graduation";

const dryRun = process.argv.includes("--dry-run");
const result = graduate(dryRun);

if (
  result.candidates.length === 0 &&
  result.graduated.length === 0 &&
  result.updated.length === 0
) {
  console.log("No patterns with 3+ occurrences found. Nothing to graduate.");
  process.exit(0);
}

if (result.candidates.length > 0) {
  console.log(`\n  Found ${result.candidates.length} pattern(s) with 3+ occurrences:\n`);
  for (const c of result.candidates) {
    console.log(`  [${c.domain}] ${c.pattern.slice(0, 80)} (${c.entries.length}x)`);
  }
}

if (result.graduated.length > 0) {
  console.log(
    `\n  ${dryRun ? "Would graduate" : "Graduated"} ${result.graduated.length} new pattern(s):\n`
  );
  for (const g of result.graduated) {
    console.log(`  [${g.domain}] ${g.pattern.slice(0, 80)} → ${g.confidence}%`);
  }
}

if (result.updated.length > 0) {
  console.log(
    `\n  ${dryRun ? "Would update" : "Updated"} ${result.updated.length} existing pattern(s):\n`
  );
  for (const u of result.updated) {
    console.log(`  [${u.domain}] ${u.pattern.slice(0, 80)} → ${u.confidence}%`);
  }
}

console.log("");
