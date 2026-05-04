/**
 * Wisdom Frames — domain-specific crystallized knowledge that compounds across sessions.
 *
 * Frame files live at memory/wisdom/frames/{domain}.md
 * Principles marked [CRYSTAL: ≥85%] are injected into every session.
 *
 * Frames are populated by Claude during conversations (via CLAUDE.md instructions),
 * not auto-extracted from transcripts.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

export interface FrameDoc {
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
