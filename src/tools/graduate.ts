#!/usr/bin/env bun
/**
 * Graduation Report — surface recurring patterns for manual crystallization.
 *
 * Reads failures and session learnings, finds patterns that recur 3+ times,
 * and generates a readable report with context for each candidate.
 * You decide what to add to wisdom frames.
 *
 * Usage: bun run tool:graduate
 */

import { graduate } from "../hooks/lib/graduation";

const result = graduate();

if (result.candidates.length === 0 && result.emerging.length === 0) {
  console.log("\n  No recurring patterns found.\n");
  process.exit(0);
}

console.log(`\n  Graduation Report — ${result.candidates.length} pattern(s) detected\n`);
console.log("  ─────────────────────────────────────────────────\n");

for (const candidate of result.candidates) {
  // Collect unique candidate principles
  const principles = [
    ...new Set(candidate.entries.map((e) => e.principle).filter((p) => p.length > 0)),
  ];

  console.log(`  [${candidate.domain}] ${candidate.entries.length}x occurrences`);
  console.log("");

  // Show each entry with date and source
  for (const entry of candidate.entries) {
    const sourceType = entry.source.startsWith("failure:") ? "failure" : "learning";
    console.log(
      `    ${entry.date || "unknown"} [${sourceType}] ${entry.text.slice(0, 100)}`
    );
  }

  // Show candidate principles from Haiku
  if (principles.length > 0) {
    console.log("\n  Suggested principles:");
    for (const p of principles) {
      console.log(`    → ${p}`);
    }
  }

  console.log("");
  console.log("  Target frame:", `memory/wisdom/frames/${candidate.domain}.md`);
  console.log("  ─────────────────────────────────────────────────\n");
}

if (result.emerging.length > 0) {
  console.log(`  Emerging (2x — one more to graduate)\n`);
  for (const group of result.emerging) {
    const principles = [
      ...new Set(group.entries.map((e) => e.principle).filter((p) => p.length > 0)),
    ];
    console.log(`  [${group.domain}] ${group.entries.length}x`);
    for (const entry of group.entries) {
      const sourceType = entry.source.startsWith("failure:") ? "failure" : "learning";
      console.log(
        `    ${entry.date || "unknown"} [${sourceType}] ${entry.text.slice(0, 80)}`
      );
    }
    if (principles.length > 0) {
      for (const p of principles) {
        console.log(`    → ${p}`);
      }
    }
    console.log("");
  }
}

if (result.candidates.length > 0) {
  console.log("  To crystallize: add a line to the wisdom frame file.");
  console.log("  Format: - Your principle here [CRYSTAL: 85%]\n");
}
