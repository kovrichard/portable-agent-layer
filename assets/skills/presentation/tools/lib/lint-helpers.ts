// presentation skill — pure helpers for the lint pipeline.
//
// Each function operates on raw markdown strings or pre-processed pieces.
// No fs, no console, no side effects — easy to test in isolation.

import { constants as fsConst } from "node:fs";
import { access } from "node:fs/promises";

export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConst.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function extractLayout(body: string): string {
  const m = /<!--\s*\.slide:\s*data-layout="([^"]+)"\s*-->/i.exec(body);
  return m ? m[1] : "content";
}

export function hasLayoutDirective(body: string): boolean {
  return /<!--\s*\.slide:\s*data-layout=/i.test(body);
}

export function stripNotes(body: string): string {
  // Remove speaker notes — every line from `Note:` onward at line start.
  const lines = body.split("\n");
  const cut = lines.findIndex((l) => /^Note:/i.test(l.trim()));
  return cut === -1 ? body : lines.slice(0, cut).join("\n");
}

export function extractNotes(body: string): string {
  // Return only the speaker notes portion (everything from `Note:` onward).
  const lines = body.split("\n");
  const cut = lines.findIndex((l) => /^Note:/i.test(l.trim()));
  return cut === -1 ? "" : lines.slice(cut).join("\n");
}

export function countAtxHeading(body: string, level: 1 | 2): string[] {
  const re = new RegExp(`^#{${level}}\\s+(.+?)\\s*$`, "gm");
  return Array.from(body.matchAll(re), (m) => m[1]);
}

export function countTopLevelListItems(body: string): number {
  // Count lines starting with `- `, `* `, or `N. ` at column 0 (no leading indent).
  let n = 0;
  for (const line of body.split("\n")) {
    if (/^(?:[-*]\s+|\d+\.\s+)/.test(line)) n++;
  }
  return n;
}

export function countAllListItems(body: string): number {
  // Count all list items at any indentation (top-level + sub-bullets).
  // The visual budget is "lines you read on the slide" — sub-bullets count.
  let n = 0;
  for (const line of body.split("\n")) {
    if (/^\s*(?:[-*]\s+|\d+\.\s+)/.test(line)) n++;
  }
  return n;
}

export type ListItem = {
  indent: number; // leading whitespace columns
  content: string; // text after the bullet marker
  raw: string; // the full line
};

export function listItems(body: string): ListItem[] {
  const out: ListItem[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^(\s*)(?:[-*]\s+|\d+\.\s+)(.*)$/);
    if (!m) continue;
    out.push({ indent: m[1].length, content: m[2], raw: line });
  }
  return out;
}

export function findImageRefs(body: string): string[] {
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

export function codeBlockLineCounts(body: string): number[] {
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

export function tableRowCount(body: string): number {
  return body.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
}

export function stripCodeAndLinks(s: string): string {
  // Remove inline code spans and markdown link bodies — useful when checking
  // bullet content for prose-style patterns without false positives on code
  // or URLs.
  return s.replace(/`[^`]*`/g, "").replace(/\[[^\]]*\]\([^)]*\)/g, "");
}

export function wordCount(s: string): number {
  // Count each inline code span as 1 word — preserves "label: `value`" patterns
  // where the substantive content is in the code span. Strip markdown link
  // bodies so links count as their visible text, not the URL.
  const withCodeAsWords = s.replace(/`[^`]*`/g, "CODESPAN");
  const withoutLinks = withCodeAsWords.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const cleaned = withoutLinks.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

export function hasNestedChildren(items: ListItem[], parentIndex: number): boolean {
  // Returns true if the item at parentIndex has any directly-following items
  // at greater indent (i.e., it acts as a parent to a sub-bullet group).
  const parent = items[parentIndex];
  if (!parent) return false;
  const next = items[parentIndex + 1];
  return !!next && next.indent > parent.indent;
}
