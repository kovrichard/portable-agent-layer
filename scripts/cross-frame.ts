#!/usr/bin/env bun
/**
 * Cross-frame synthesis CLI
 * 
 * Run manually to analyze wisdom frames:
 *   bun run cross-frame.ts
 * 
 * Shows:
 *   - Principles appearing across multiple domains
 *   - Frame health metrics
 *   - Recommendations for attention
 */

import { runCrossFrameSynthesis, formatHealthReport } from "../hooks/lib/cross-frame";

const result = runCrossFrameSynthesis();

console.log(formatHealthReport(result.health));

if (result.crossPrinciples.length > 0) {
  console.log("\n🔗 Cross-Domain Principles:");
  console.log("   (Written to memory/wisdom/verified-principles.md)");
  console.log("");
  for (const p of result.crossPrinciples) {
    console.log(`  • "${p.text.slice(0, 60)}..." (${p.count} domains)`);
  }
}

console.log("\n✅ Cross-frame analysis complete");
