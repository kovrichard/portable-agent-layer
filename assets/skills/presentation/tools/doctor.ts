#!/usr/bin/env bun
// presentation skill — lint a deck before build.
//
// Usage:
//   bun doctor.ts <deck-dir> [--strict]
//
// Reads slides/*.md (or legacy content.md), runs layout-aware lint rules,
// prints per-slide findings + a summary, and exits 0 (clean) or 1 (errors).
// --strict promotes warnings to errors.
//
// Rules are heuristic — thresholds documented in SKILL.md. Doctor is a
// safety-net, not a style guide; intentionally permissive.

import { constants as fsConst } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { readText } from "./lib/inline";

export type Severity = "E" | "W";
export type Finding = { rule: string; severity: Severity; msg: string };
export type SlideReport = { name: string; layout: string; findings: Finding[] };

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConst.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadSlides(deckDir: string): Promise<{ name: string; body: string }[]> {
  const slidesDir = join(deckDir, "slides");
  if (await exists(slidesDir)) {
    const files = (await readdir(slidesDir)).filter((f) => f.endsWith(".md")).sort();
    if (files.length === 0) throw new Error(`slides/ is empty at ${slidesDir}`);
    return Promise.all(
      files.map(async (f) => ({ name: f, body: await readText(join(slidesDir, f)) }))
    );
  }
  const legacy = join(deckDir, "content.md");
  if (await exists(legacy)) {
    const raw = await readText(legacy);
    return raw.split(/^---$/m).map((body, i) => ({ name: `slide-${i + 1}`, body }));
  }
  throw new Error(`no slides/ directory or content.md found in ${deckDir}`);
}

export function extractLayout(body: string): string {
  const m = /<!--\s*\.slide:\s*data-layout="([^"]+)"\s*-->/i.exec(body);
  return m ? m[1] : "content";
}

function stripNotes(body: string): string {
  // Remove speaker notes — every line from `Note:` onward at line start.
  const lines = body.split("\n");
  const cut = lines.findIndex((l) => /^Note:/i.test(l.trim()));
  return cut === -1 ? body : lines.slice(0, cut).join("\n");
}

function countAtxHeading(body: string, level: 1 | 2): string[] {
  const re = new RegExp(`^#{${level}}\\s+(.+?)\\s*$`, "gm");
  return Array.from(body.matchAll(re), (m) => m[1]);
}

function countTopLevelListItems(body: string): number {
  // Count lines starting with `- `, `* `, or `N. ` at column 0 (no leading indent).
  let n = 0;
  for (const line of body.split("\n")) {
    if (/^(?:[-*]\s+|\d+\.\s+)/.test(line)) n++;
  }
  return n;
}

function findImageRefs(body: string): string[] {
  // Skip lines inside fenced code blocks — they're examples, not references.
  const out: string[] = [];
  const lines = body.split("\n");
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const m of line.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      const ref = m[1].trim();
      if (!/^(https?:|data:)/i.test(ref)) out.push(ref);
    }
  }
  return out;
}

function codeBlockLineCounts(body: string): number[] {
  const counts: number[] = [];
  const lines = body.split("\n");
  let inBlock = false;
  let n = 0;
  for (const l of lines) {
    if (/^```/.test(l)) {
      if (inBlock) {
        counts.push(n);
        n = 0;
        inBlock = false;
      } else {
        inBlock = true;
      }
    } else if (inBlock) {
      n++;
    }
  }
  return counts;
}

export async function lintSlide(
  slide: { name: string; body: string },
  deckDir: string
): Promise<SlideReport> {
  const layout = extractLayout(slide.body);
  const body = stripNotes(slide.body);
  const findings: Finding[] = [];

  const has = (s: string) => body.includes(s);
  const heads1 = countAtxHeading(body, 1);
  const heads2 = countAtxHeading(body, 2);

  // ── Global rules ──────────────────────────────────────────────────────
  if (!/<!--\s*\.slide:\s*data-layout=/i.test(slide.body)) {
    findings.push({
      rule: "no-layout",
      severity: "W",
      msg: "no <!-- .slide: data-layout=\"...\" --> directive — defaults to 'content'",
    });
  }
  for (const h of heads1) {
    if (h.length > 60) {
      findings.push({
        rule: "long-title",
        severity: "W",
        msg: `h1 is ${h.length} chars (soft limit 60): "${h.slice(0, 50)}…"`,
      });
    }
  }
  for (const h of heads2) {
    if (h.length > 100) {
      findings.push({
        rule: "long-subtitle",
        severity: "W",
        msg: `h2 is ${h.length} chars (soft limit 100)`,
      });
    }
  }
  for (const ref of findImageRefs(body)) {
    const abs = resolve(deckDir, ref);
    if (!(await exists(abs))) {
      findings.push({
        rule: "missing-asset",
        severity: "E",
        msg: `image referenced but not found: ${ref}`,
      });
    }
  }

  // ── Layout-specific rules ─────────────────────────────────────────────
  switch (layout) {
    case "title":
    case "closing": {
      if (heads1.length === 0) {
        findings.push({
          rule: "title-no-h1",
          severity: "E",
          msg: "missing h1 (deck title)",
        });
      }
      break;
    }
    case "section": {
      if (heads1.length === 0) {
        findings.push({
          rule: "section-no-h1",
          severity: "W",
          msg: "section divider with no h1",
        });
      }
      break;
    }
    case "agenda": {
      const items = countTopLevelListItems(body);
      if (items > 10) {
        findings.push({
          rule: "agenda-overflow",
          severity: "W",
          msg: `${items} items — agenda fits 10 cleanly; split into two slides`,
        });
      }
      if (items === 0) {
        findings.push({
          rule: "agenda-empty",
          severity: "E",
          msg: "agenda layout has no list items",
        });
      }
      break;
    }
    case "content": {
      const items = countTopLevelListItems(body);
      if (items > 7) {
        findings.push({
          rule: "content-bullets",
          severity: "W",
          msg: `${items} bullets — content slides fit ~7 cleanly`,
        });
      }
      break;
    }
    case "comparison": {
      if (!has(`class="compare"`)) {
        findings.push({
          rule: "comparison-wrapper",
          severity: "E",
          msg: 'missing <div class="compare"> wrapper',
        });
      }
      const options = (body.match(/class="option"/g) || []).length;
      if (options === 0) {
        findings.push({
          rule: "comparison-empty",
          severity: "E",
          msg: "no .option blocks found",
        });
      } else if (options > 3) {
        findings.push({
          rule: "comparison-count",
          severity: "W",
          msg: `${options} options — comparison fits 2–3 cleanly`,
        });
      }
      break;
    }
    case "metric-grid": {
      if (!has(`class="metrics"`)) {
        findings.push({
          rule: "metric-grid-wrapper",
          severity: "E",
          msg: 'missing <div class="metrics"> wrapper',
        });
      }
      const metrics = (body.match(/class="metric"/g) || []).length;
      if (metrics === 0) {
        findings.push({
          rule: "metric-grid-empty",
          severity: "E",
          msg: "no .metric blocks found",
        });
      } else if (metrics !== 3) {
        findings.push({
          rule: "metric-grid-count",
          severity: "W",
          msg: `${metrics} metrics — grid is 3-column, expects exactly 3`,
        });
      }
      break;
    }
    case "two-column": {
      if (!has(`class="col-left"`) || !has(`class="col-right"`)) {
        findings.push({
          rule: "two-column-wrappers",
          severity: "E",
          msg: 'missing <div class="col-left"> or <div class="col-right">',
        });
      }
      break;
    }
    case "image-text": {
      if (!has(`class="image"`) || !has(`class="text"`)) {
        findings.push({
          rule: "image-text-wrappers",
          severity: "E",
          msg: 'missing <div class="image"> or <div class="text">',
        });
      }
      break;
    }
    case "big-stat": {
      if (heads1.length === 0) {
        findings.push({
          rule: "big-stat-no-h1",
          severity: "E",
          msg: "missing h1 (the stat itself)",
        });
      } else if (heads1.length > 1) {
        findings.push({
          rule: "big-stat-multi-h1",
          severity: "W",
          msg: "multiple h1s — big-stat shows one number",
        });
      }
      break;
    }
    case "quote":
    case "pull-quote": {
      if (!/^>\s+/m.test(body)) {
        findings.push({
          rule: "quote-no-blockquote",
          severity: "E",
          msg: "no blockquote (`> ...`) found",
        });
      }
      break;
    }
    case "code": {
      const blocks = codeBlockLineCounts(body);
      if (blocks.length === 0) {
        findings.push({
          rule: "code-no-block",
          severity: "E",
          msg: "no fenced code block found",
        });
      }
      for (const n of blocks) {
        if (n > 25) {
          findings.push({
            rule: "code-too-long",
            severity: "W",
            msg: `code block has ${n} lines — fits ~25 before overflow`,
          });
        }
      }
      break;
    }
    case "table": {
      const rows = body.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
      if (rows > 10) {
        findings.push({
          rule: "table-rows",
          severity: "W",
          msg: `${rows} table rows — gets cramped past ~8`,
        });
      }
      break;
    }
  }

  return { name: slide.name, layout, findings };
}

function pad(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - s.length));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("usage: doctor.ts <deck-dir> [--strict]");
    process.exit(2);
  }
  const deckDir = resolve(argv[0]);
  const strict = argv.includes("--strict");

  const slides = await loadSlides(deckDir);
  const reports = await Promise.all(slides.map((s) => lintSlide(s, deckDir)));

  let errors = 0;
  let warnings = 0;
  let printed = false;

  for (const r of reports) {
    if (r.findings.length === 0) continue;
    if (!printed) {
      console.log(`Doctor — ${basename(deckDir)} (${slides.length} slides)`);
      console.log("");
      printed = true;
    }
    console.log(`  ${pad(r.name, 32)} [${r.layout}]`);
    for (const f of r.findings) {
      const sev = f.severity === "E" ? "ERROR" : "WARN ";
      const symbol = f.severity === "E" ? "✗" : "⚠";
      console.log(`    ${symbol} ${sev}  ${f.rule.padEnd(22)} ${f.msg}`);
      if (f.severity === "E") errors++;
      else warnings++;
    }
  }

  const total = errors + warnings;
  if (total === 0) {
    console.log(`✓ Doctor — ${basename(deckDir)} (${slides.length} slides) — all clean`);
    process.exit(0);
  }

  console.log("");
  console.log(
    `Summary: ${errors} error(s), ${warnings} warning(s) across ${slides.length} slides`
  );

  const exitCode = errors > 0 || (strict && warnings > 0) ? 1 : 0;
  process.exit(exitCode);
}

// Only run as a CLI when invoked directly — allows test files to import lintSlide
// without triggering the argv parsing / process.exit path.
if (import.meta.main) {
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(2);
  });
}
