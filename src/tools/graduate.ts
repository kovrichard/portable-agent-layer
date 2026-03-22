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

if (result.candidates.length === 0) {
  console.log("\n  No recurring patterns found (need 3+ similar entries).\n");
  process.exit(0);
}

console.log(`\n  Graduation Report — ${result.candidates.length} pattern(s) detected\n`);
console.log("  ─────────────────────────────────────────────────\n");

for (const candidate of result.candidates) {
  // Collect unique tags across all entries
  const allTags = [...new Set(candidate.entries.flatMap((e) => e.tags))];

  console.log(`  [${candidate.domain}] ${candidate.entries.length}x occurrences`);
  if (allTags.length > 0) {
    console.log(`  Tags: ${allTags.join(", ")}`);
  }
  console.log("");

  // Show each entry with date and source
  for (const entry of candidate.entries) {
    const sourceType = entry.source.startsWith("failure:") ? "failure" : "learning";
    console.log(
      `    ${entry.date || "unknown"} [${sourceType}] ${entry.text.slice(0, 100)}`
    );
  }

  console.log("");
  console.log(
    "  → Consider adding a principle to:",
    `memory/wisdom/frames/${candidate.domain}.md`
  );
  console.log("  ─────────────────────────────────────────────────\n");
}

console.log("  To crystallize: add a line to the wisdom frame file.");
console.log("  Format: - Your principle here [CRYSTAL: 85%]\n");
