#!/usr/bin/env bun
/**
 * Principle Evaluation — generate, regenerate, or compare candidate principles.
 *
 * Reads failures (capture.md) and learnings (frontmatter .md) and uses Haiku
 * to generate candidate principles. Useful for tuning prompt quality.
 *
 * Modes:
 *   --dry-run     Preview which files would be updated
 *   --evaluate    Show current vs new principle for comparison (does not write)
 *   --force       Regenerate principles even if one already exists
 *   (default)     Generate missing principles only
 *
 * Usage:
 *   bun run tool:eval                    # generate missing
 *   bun run tool:eval -- --dry-run       # preview
 *   bun run tool:eval -- --evaluate      # compare current vs new
 *   bun run tool:eval -- --force         # regenerate all
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasFrontmatter, parse, stringify } from "../hooks/lib/frontmatter";
import { inference } from "../hooks/lib/inference";
import { palHome } from "../hooks/lib/paths";
import {
  FAILURE_PRINCIPLE_PROMPT,
  LEARNING_PRINCIPLE_PROMPT,
} from "../hooks/lib/prompts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const evaluate = args.includes("--evaluate");
const force = args.includes("--force");

const home = palHome();
let processed = 0;
let skipped = 0;
let failed = 0;

async function generatePrinciple(systemPrompt: string, context: string): Promise<string> {
  const result = await inference({
    system: systemPrompt,
    user: context,
    maxTokens: 100,
    timeout: 10000,
    jsonSchema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        principle: { type: "string" as const },
      },
      required: ["principle"],
    },
  });

  if (result.success && result.output) {
    const parsed = JSON.parse(result.output) as { principle?: string };
    const principle = parsed.principle?.trim() || "";
    if (principle.length > 10) return principle;
  }
  return "";
}

// ── Failures ──

async function processFailures() {
  const failuresDir = resolve(home, "memory", "learning", "failures");
  if (!existsSync(failuresDir)) return;

  for (const year of readdirSync(failuresDir)) {
    const yearDir = resolve(failuresDir, year);
    for (const month of readdirSync(yearDir)) {
      const monthDir = resolve(yearDir, month);
      for (const slug of readdirSync(monthDir)) {
        const capturePath = resolve(monthDir, slug, "capture.md");
        if (!existsSync(capturePath)) continue;

        const content = readFileSync(capturePath, "utf-8");
        if (!hasFrontmatter(content)) continue;

        const { meta, body } = parse<{
          principle?: string;
          context?: string;
          rating?: number;
        }>(content);

        const hasPrinciple = !!meta.principle;
        if (hasPrinciple && !force && !evaluate) {
          skipped++;
          continue;
        }

        const context = meta.context || "";
        if (!context) {
          skipped++;
          continue;
        }

        const inputContext = `Rating: ${meta.rating}/10\nContext: ${context}\n\n${body.slice(0, 400)}`;

        if (dryRun) {
          console.log(`  [failure] ${slug.slice(0, 60)}`);
          processed++;
          continue;
        }

        try {
          const newPrinciple = await generatePrinciple(
            FAILURE_PRINCIPLE_PROMPT,
            inputContext
          );
          if (!newPrinciple) {
            skipped++;
            continue;
          }

          if (evaluate) {
            console.log(`  [failure] ${slug.slice(0, 50)}`);
            if (hasPrinciple) {
              console.log(`    OLD: ${meta.principle}`);
            }
            console.log(`    NEW: ${newPrinciple}`);
            console.log("");
            processed++;
            continue;
          }

          const newMeta = { ...meta, principle: newPrinciple } as Record<string, unknown>;
          writeFileSync(capturePath, stringify(newMeta, body), "utf-8");
          console.log(`  [failure] ${slug.slice(0, 60)}`);
          processed++;
        } catch {
          failed++;
        }
      }
    }
  }
}

// ── Learnings ──

async function processLearnings() {
  const learningDir = resolve(home, "memory", "learning", "session");
  if (!existsSync(learningDir)) return;

  for (const year of readdirSync(learningDir)) {
    const yearDir = resolve(learningDir, year);
    for (const month of readdirSync(yearDir)) {
      const monthDir = resolve(yearDir, month);
      for (const file of readdirSync(monthDir).filter((f) => f.endsWith(".md"))) {
        const filepath = resolve(monthDir, file);
        const content = readFileSync(filepath, "utf-8");

        if (!hasFrontmatter(content)) {
          skipped++;
          continue;
        }

        const { meta, body } = parse<{
          principle?: string;
          title?: string;
        }>(content);

        const hasPrinciple = !!meta.principle;
        if (hasPrinciple && !force && !evaluate) {
          skipped++;
          continue;
        }

        const title = meta.title || "";
        if (!title) {
          skipped++;
          continue;
        }

        const inputContext = `Title: ${title}\n\n${body.slice(0, 400)}`;

        if (dryRun) {
          console.log(`  [learning] ${file.slice(0, 60)}`);
          processed++;
          continue;
        }

        try {
          const newPrinciple = await generatePrinciple(
            LEARNING_PRINCIPLE_PROMPT,
            inputContext
          );
          if (!newPrinciple) {
            skipped++;
            continue;
          }

          if (evaluate) {
            console.log(`  [learning] ${file.slice(0, 50)}`);
            if (hasPrinciple) {
              console.log(`    OLD: ${meta.principle}`);
            }
            console.log(`    NEW: ${newPrinciple}`);
            console.log("");
            processed++;
            continue;
          }

          const newMeta = { ...meta, principle: newPrinciple } as Record<string, unknown>;
          writeFileSync(filepath, stringify(newMeta, body), "utf-8");
          console.log(`  [learning] ${file.slice(0, 60)}`);
          processed++;
        } catch {
          failed++;
        }
      }
    }
  }
}

// ── Main ──

const mode = evaluate
  ? "evaluate"
  : force
    ? "force regenerate"
    : dryRun
      ? "dry run"
      : "backfill";
console.log(`\n  Principle ${mode}...\n`);

await processFailures();
await processLearnings();

console.log(
  `\n  Done: ${processed} ${evaluate ? "compared" : "processed"}, ${skipped} skipped, ${failed} failed\n`
);
