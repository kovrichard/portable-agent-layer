#!/usr/bin/env bun
/**
 * OpinionTracker — manage confidence-tracked opinions about the user.
 *
 * Called by the AI during conversation when it detects confirmations,
 * contradictions, or new behavioral patterns.
 *
 * Usage:
 *   bun opinion.ts list                                      List all opinions
 *   bun opinion.ts show "statement"                          Show opinion details
 *   bun opinion.ts add "statement" [--category workflow]     Add new opinion
 *   bun opinion.ts evidence "statement" --supporting "why"   Add supporting evidence
 *   bun opinion.ts evidence "statement" --counter "why"      Add counter evidence
 *   bun opinion.ts evidence "statement" --confirmation "why" Explicit user confirmation
 *   bun opinion.ts evidence "statement" --contradiction "why" Explicit user contradiction
 */

import {
  addEvidence,
  createOpinion,
  type EvidenceType,
  findSimilarOpinion,
  type OpinionCategory,
  readOpinions,
  saveOpinion,
} from "../../../../src/hooks/lib/opinions";

const args = process.argv.slice(2);
const command = args[0];

const NOTIFICATION_THRESHOLD = 0.15;

function flag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

function bar(confidence: number): string {
  const filled = Math.round(confidence * 10);
  return "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
}

switch (command) {
  case "list": {
    const opinions = readOpinions();
    if (opinions.length === 0) {
      console.log("\n  No opinions tracked yet.\n");
      break;
    }

    const categories = new Map<string, typeof opinions>();
    for (const op of opinions) {
      const list = categories.get(op.category) ?? [];
      list.push(op);
      categories.set(op.category, list);
    }

    console.log(`\n  ${c.bold("Tracked Opinions")} (${opinions.length} total)\n`);

    for (const [category, ops] of categories) {
      console.log(`  ${c.cyan(category)}`);
      for (const op of ops.sort((a, b) => b.confidence - a.confidence)) {
        const pct = `${Math.round(op.confidence * 100)}%`;
        const color =
          op.confidence >= 0.85 ? c.green : op.confidence <= 0.3 ? c.red : c.yellow;
        console.log(`    [${bar(op.confidence)}] ${color(pct)} ${op.statement}`);
      }
      console.log("");
    }
    break;
  }

  case "show": {
    const statement = args[1];
    if (!statement) {
      console.error('Usage: bun opinion.ts show "statement"');
      process.exit(1);
    }

    const opinions = readOpinions();
    const match = findSimilarOpinion(statement, opinions);
    if (!match) {
      console.error(`  No matching opinion found for: "${statement}"`);
      process.exit(1);
    }

    const pct = Math.round(match.confidence * 100);
    console.log(`\n  ${c.bold("Opinion Details")}\n`);
    console.log(`  ${c.bold("Statement:")} ${match.statement}`);
    console.log(`  ${c.bold("Confidence:")} [${bar(match.confidence)}] ${pct}%`);
    console.log(`  ${c.bold("Category:")} ${match.category}`);
    console.log(`  ${c.bold("Created:")} ${match.created}`);
    console.log(`  ${c.bold("Updated:")} ${match.updated}`);
    console.log(`\n  ${c.bold("Evidence")} (${match.evidence.length} items)\n`);

    const supporting = match.evidence.filter(
      (e) => e.type === "supporting" || e.type === "confirmation"
    );
    const counter = match.evidence.filter(
      (e) => e.type === "counter" || e.type === "contradiction"
    );

    if (supporting.length > 0) {
      console.log(`  ${c.green("Supporting:")}`);
      for (const e of supporting) {
        console.log(`    ${c.dim(e.date)} [${e.type}] ${e.source}`);
      }
    }
    if (counter.length > 0) {
      console.log(`  ${c.red("Counter:")}`);
      for (const e of counter) {
        console.log(`    ${c.dim(e.date)} [${e.type}] ${e.source}`);
      }
    }
    console.log("");
    break;
  }

  case "add": {
    const statement = args[1];
    if (!statement) {
      console.error('Usage: bun opinion.ts add "statement" [--category workflow]');
      process.exit(1);
    }

    const category = (flag("category") || "general") as OpinionCategory;
    const opinions = readOpinions();
    const existing = findSimilarOpinion(statement, opinions);

    if (existing) {
      console.log(
        `  Similar opinion already exists: "${existing.statement}" (${Math.round(existing.confidence * 100)}%)`
      );
      break;
    }

    const opinion = createOpinion(statement, "manual add");
    opinion.category = category;
    saveOpinion(opinion);
    console.log(`  Added: "${statement}" [${category}] at 50%`);
    break;
  }

  case "evidence": {
    const statement = args[1];
    if (!statement) {
      console.error(
        'Usage: bun opinion.ts evidence "statement" --supporting "description"'
      );
      process.exit(1);
    }

    const opinions = readOpinions();
    const match = findSimilarOpinion(statement, opinions);
    if (!match) {
      console.error(`  No matching opinion found for: "${statement}"`);
      process.exit(1);
    }

    let evidenceType: EvidenceType | undefined;
    let description: string | undefined;

    for (const t of ["supporting", "counter", "confirmation", "contradiction"] as const) {
      const val = flag(t);
      if (val) {
        evidenceType = t;
        description = val;
        break;
      }
    }

    if (!evidenceType || !description) {
      console.error(
        "  Provide one of: --supporting, --counter, --confirmation, --contradiction"
      );
      process.exit(1);
    }

    const oldConfidence = match.confidence;
    const updated = addEvidence(match, evidenceType, description);
    saveOpinion(updated);

    const shift = updated.confidence - oldConfidence;
    const arrow = shift > 0 ? c.green("\u2191") : c.red("\u2193");
    console.log(
      `  ${arrow} ${Math.round(oldConfidence * 100)}% \u2192 ${Math.round(updated.confidence * 100)}% "${match.statement}"`
    );
    console.log(`    [${evidenceType}] ${description}`);

    if (Math.abs(shift) >= NOTIFICATION_THRESHOLD) {
      console.log(
        `\n  ${c.bold(c.yellow("Major shift detected!"))} (${shift > 0 ? "+" : ""}${Math.round(shift * 100)}%)`
      );
    }
    break;
  }

  case "--help":
  case "-h":
  case "help":
  case undefined: {
    console.log(`
  OpinionTracker — manage confidence-tracked opinions about the user

  The "statement" argument is fuzzy-matched (Dice similarity) against all
  stored opinions. Use a few keywords from the opinion, not the exact text.

  Commands:
    list                                      List all opinions with confidence bars
    show "keywords"                           Show opinion details + full evidence history
    add "statement" [--category X]            Create new opinion (starts at 50%)
    evidence "keywords" --supporting "why"    Supporting evidence (+2%)
    evidence "keywords" --counter "why"       Counter evidence (-5%)
    evidence "keywords" --confirmation "why"  User explicitly confirmed (+10%)
    evidence "keywords" --contradiction "why" User explicitly contradicted (-20%)

  Categories: communication, technical, workflow, general
`);
    break;
  }

  default:
    console.error(`  Unknown command: ${command}. Run with --help for usage.`);
    process.exit(1);
}
