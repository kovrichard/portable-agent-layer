/**
 * Wisdom Frames — domain-specific crystallized knowledge that compounds across sessions.
 *
 * Frame files live at memory/wisdom/frames/{domain}.md
 * Principles marked [CRYSTAL: ≥85%] are injected into every session.
 *
 * Frames are populated by Claude during conversations (via CLAUDE.md instructions),
 * not auto-extracted from transcripts.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";
import { similarity } from "./text-similarity";

/** Dice-similarity floor for "principle already represented" — matches graduation.ts. */
const PRINCIPLE_DEDUP_THRESHOLD = 0.3;
const PRINCIPLES_PLACEHOLDER =
  "*No crystallized principles yet. Observations accumulating.*";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function scaffoldFrame(domain: string): string {
  const t = today();
  return `# Frame: ${domain.charAt(0).toUpperCase() + domain.slice(1)}

## Meta
- **Domain:** ${domain}
- **Observation Count:** 0
- **Last Updated:** ${t}

---

## Core Principles

${PRINCIPLES_PLACEHOLDER}

---

## Contextual Rules

*None yet.*

---

## Anti-Patterns

*None yet.*

---

## Evolution Log
- ${t}: Frame scaffolded by auto-graduate
`;
}

/** Existing CRYSTAL principle texts in the frame content (both v4 heading + legacy bullet). */
function existingCrystalPrinciples(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/^### (.+?) \[CRYSTAL:\s*\d+%\]/gm)) {
    if (m[1]) out.push(m[1].trim());
  }
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*-\s*(.+?)\s*\[CRYSTAL:\s*\d+%\]\s*$/);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

interface PromoteCrystalResult {
  domain: string;
  principle: string;
  confidence: number;
  framePath: string;
  /** "duplicate" → a Dice-similar CRYSTAL line already existed; nothing written. */
  skipped: "duplicate" | null;
}

/**
 * Idempotently promote a graduated principle to a wisdom-frame CRYSTAL line.
 *
 * Content-dedup: if any existing CRYSTAL line in the frame is Dice-similar
 * (≥0.3) to `principle`, the call is a no-op. Combined with the auto-graduate
 * handler's TTL guard and state-dedup, this means N rapid calls with the same
 * input produce ≤1 file write — the property the past failed attempt missed.
 */
export function promoteCrystal(
  domain: string,
  principle: string,
  confidence: number
): PromoteCrystalResult {
  const framesDir = paths.wisdom();
  mkdirSync(framesDir, { recursive: true });
  const framePath = resolve(framesDir, `${domain}.md`);

  if (!existsSync(framePath)) {
    writeFileSync(framePath, scaffoldFrame(domain));
  }

  let content = readFileSync(framePath, "utf-8");

  for (const existing of existingCrystalPrinciples(content)) {
    if (similarity(principle, existing) >= PRINCIPLE_DEDUP_THRESHOLD) {
      return { domain, principle, confidence, framePath, skipped: "duplicate" };
    }
  }

  const newLine = `### ${principle} [CRYSTAL: ${confidence}%]`;

  if (content.includes(PRINCIPLES_PLACEHOLDER)) {
    content = content.replace(PRINCIPLES_PLACEHOLDER, newLine);
  } else {
    content = content.replace(/(## Core Principles\n+)/, `$1${newLine}\n\n`);
  }

  content = content.replace(/(\*\*Last Updated:\*\*\s*)\S+/, `$1${today()}`);
  const evolutionEntry = `- ${today()}: Auto-promoted to CRYSTAL ${confidence}% — ${principle}`;
  content = content.replace(/(## Evolution Log\n)/, `$1${evolutionEntry}\n`);

  writeFileSync(framePath, content);
  return { domain, principle, confidence, framePath, skipped: null };
}

interface FrameDoc {
  domain: string;
  principle: string;
  body: string;
  confidence: number;
}

/** Extract every CRYSTAL principle as a structured doc (domain + principle + surrounding body + confidence).
 *  Body is the first ~600 chars of the frame for ranking context.
 *  Used by the retrieval indexer; readFramePrinciples remains for SessionStart formatting. */
export function readFramesForRetrieval(): FrameDoc[] {
  const framesDir = paths.wisdom();
  const docs: FrameDoc[] = [];

  if (!existsSync(framesDir)) return docs;

  for (const file of readdirSync(framesDir).filter((f) => f.endsWith(".md"))) {
    const domain = file.replace(".md", "");
    const content = readFileSync(resolve(framesDir, file), "utf-8");
    const body = content.slice(0, 600);

    for (const match of content.matchAll(/^### (.+?) \[CRYSTAL:\s*(\d+)%\]/gm)) {
      const name = match[1]?.trim();
      const pct = parseInt(match[2] ?? "", 10);
      if (name && Number.isFinite(pct) && pct >= 85) {
        docs.push({ domain, principle: name, body, confidence: pct });
      }
    }

    for (const line of content.split("\n")) {
      const m = line.match(/^\s*-\s*(.+?)\s*\[CRYSTAL:\s*(\d+)%\]\s*$/);
      if (!m) continue;
      const name = m[1]?.trim();
      const pct = parseInt(m[2] ?? "", 10);
      if (name && Number.isFinite(pct) && pct >= 85) {
        docs.push({ domain, principle: name, body, confidence: pct });
      }
    }
  }

  return docs;
}

/** Extract CRYSTAL principles (≥85% confidence) from all frame files */
export function readFramePrinciples(): string[] {
  const framesDir = paths.wisdom();
  const principles: string[] = [];

  if (!existsSync(framesDir)) return principles;

  for (const file of readdirSync(framesDir).filter((f) => f.endsWith(".md"))) {
    const domain = file.replace(".md", "");
    const content = readFileSync(resolve(framesDir, file), "utf-8");

    // v4: headings "### Name [CRYSTAL: N%]"
    for (const match of content.matchAll(/^### (.+?) \[CRYSTAL:\s*(\d+)%\]/gm)) {
      const name = match[1]?.trim();
      const pct = parseInt(match[2] ?? "", 10);
      if (name && Number.isFinite(pct) && pct >= 85) {
        principles.push(`[${domain}] ${name} (${pct}%)`);
      }
    }

    // legacy fallback: bullet lines "- X [CRYSTAL: N%]"
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*-\s*(.+?)\s*\[CRYSTAL:\s*(\d+)%\]\s*$/);
      if (!match) continue;
      const name = match[1]?.trim();
      const pct = parseInt(match[2] ?? "", 10);
      if (name && Number.isFinite(pct) && pct >= 85) {
        principles.push(`[${domain}] ${name} (${pct}%)`);
      }
    }
  }

  return principles;
}
