#!/usr/bin/env bun
// presentation skill — lint a deck before build.
//
// Usage:
//   bun doctor.ts <deck-dir> [--strict]
//
// Reads slides/*.md (or legacy content.md), runs slide-scope and deck-scope
// rules from `lib/lint-rules.ts`, prints per-slide findings + a summary,
// and exits 0 (clean) or 1 (errors). --strict promotes warnings to errors.
//
// Rules are heuristic — thresholds documented in SKILL.md. The doctor is a
// safety-net, not a style guide; intentionally permissive.

import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { readText } from "./lib/inline";
import {
  countAtxHeading,
  extractLayout,
  fileExists,
  stripNotes,
} from "./lib/lint-helpers";
import { RULES } from "./lib/lint-rules";
import type { DeckContext, Finding, SlideContext, SlideReport } from "./lib/lint-types";

// Re-export for backward compatibility with external callers (tests, etc.)
// that imported these directly from doctor.ts.
export { extractLayout } from "./lib/lint-helpers";
export type { DeckContext, Finding, SlideContext, SlideReport } from "./lib/lint-types";

async function loadSlides(deckDir: string): Promise<{ name: string; body: string }[]> {
  const slidesDir = join(deckDir, "slides");
  if (await fileExists(slidesDir)) {
    const files = (await readdir(slidesDir)).filter((f) => f.endsWith(".md")).sort();
    if (files.length === 0) throw new Error(`slides/ is empty at ${slidesDir}`);
    return Promise.all(
      files.map(async (f) => ({ name: f, body: await readText(join(slidesDir, f)) }))
    );
  }
  const legacy = join(deckDir, "content.md");
  if (await fileExists(legacy)) {
    const raw = await readText(legacy);
    return raw.split(/^---$/m).map((body, i) => ({ name: `slide-${i + 1}`, body }));
  }
  throw new Error(`no slides/ directory or content.md found in ${deckDir}`);
}

function buildSlideContext(
  slide: { name: string; body: string },
  index: number,
  deckDir: string
): SlideContext {
  const body = slide.body;
  const bodyNoNotes = stripNotes(body);
  return {
    name: slide.name,
    body,
    bodyNoNotes,
    layout: extractLayout(body),
    deckDir,
    heads1: countAtxHeading(bodyNoNotes, 1),
    heads2: countAtxHeading(bodyNoNotes, 2),
    index,
  };
}

export async function lintDeck(deckDir: string): Promise<{
  slides: SlideContext[];
  reports: SlideReport[];
  deckFindings: Finding[];
}> {
  const raw = await loadSlides(deckDir);
  const slides = raw.map((s, i) => buildSlideContext(s, i, deckDir));
  const deckCtx: DeckContext = { deckDir, slides };

  // Slide-scope rules
  const reports: SlideReport[] = [];
  for (const ctx of slides) {
    const findings: Finding[] = [];
    for (const rule of RULES) {
      if (rule.scope !== "slide") continue;
      if (rule.appliesTo && !rule.appliesTo(ctx)) continue;
      findings.push(...(await rule.check(ctx)));
    }
    reports.push({ name: ctx.name, layout: ctx.layout, findings });
  }

  // Deck-scope rules
  const deckFindings: Finding[] = [];
  for (const rule of RULES) {
    if (rule.scope !== "deck") continue;
    deckFindings.push(...(await rule.check(deckCtx)));
  }

  return { slides, reports, deckFindings };
}

// Public: kept for any external caller that imported `lintSlide` directly.
export async function lintSlide(
  slide: { name: string; body: string },
  deckDir: string
): Promise<SlideReport> {
  const ctx = buildSlideContext(slide, 0, deckDir);
  const findings: Finding[] = [];
  for (const rule of RULES) {
    if (rule.scope !== "slide") continue;
    if (rule.appliesTo && !rule.appliesTo(ctx)) continue;
    findings.push(...(await rule.check(ctx)));
  }
  return { name: ctx.name, layout: ctx.layout, findings };
}

function pad(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - s.length));
}

function printSlideFindings(reports: SlideReport[], deckBase: string, count: number) {
  let printed = false;
  for (const r of reports) {
    if (r.findings.length === 0) continue;
    if (!printed) {
      console.log(`Doctor — ${deckBase} (${count} slides)`);
      console.log("");
      printed = true;
    }
    console.log(`  ${pad(r.name, 32)} [${r.layout}]`);
    for (const f of r.findings) {
      const sev = f.severity === "E" ? "ERROR" : "WARN ";
      const symbol = f.severity === "E" ? "✗" : "⚠";
      console.log(`    ${symbol} ${sev}  ${f.rule.padEnd(28)} ${f.msg}`);
    }
  }
  return printed;
}

function printDeckFindings(deckFindings: Finding[], anyPrintedAlready: boolean): boolean {
  if (deckFindings.length === 0) return anyPrintedAlready;
  if (anyPrintedAlready) console.log("");
  console.log("  (deck-level)");
  for (const f of deckFindings) {
    const sev = f.severity === "E" ? "ERROR" : "WARN ";
    const symbol = f.severity === "E" ? "✗" : "⚠";
    console.log(`    ${symbol} ${sev}  ${f.rule.padEnd(28)} ${f.msg}`);
  }
  return true;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("usage: doctor.ts <deck-dir> [--strict]");
    process.exit(2);
  }
  const deckDir = resolve(argv[0]);
  const strict = argv.includes("--strict");

  const { slides, reports, deckFindings } = await lintDeck(deckDir);

  let errors = 0;
  let warnings = 0;
  for (const r of reports) {
    for (const f of r.findings) {
      if (f.severity === "E") errors++;
      else warnings++;
    }
  }
  for (const f of deckFindings) {
    if (f.severity === "E") errors++;
    else warnings++;
  }

  const total = errors + warnings;
  if (total === 0) {
    console.log(`✓ Doctor — ${basename(deckDir)} (${slides.length} slides) — all clean`);
    process.exit(0);
  }

  const anyPrinted = printSlideFindings(reports, basename(deckDir), slides.length);
  printDeckFindings(deckFindings, anyPrinted);

  console.log("");
  console.log(
    `Summary: ${errors} error(s), ${warnings} warning(s) across ${slides.length} slides`
  );

  const exitCode = errors > 0 || (strict && warnings > 0) ? 1 : 0;
  process.exit(exitCode);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(2);
  });
}
