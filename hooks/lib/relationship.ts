/**
 * Relationship Memory — daily interaction notes tracking preferences,
 * frustrations, positive signals, and milestones.
 *
 * Notes live at memory/relationship/YYYY-MM/YYYY-MM-DD.md
 * W = world (facts about user's situation)
 * B = biographical (what the AI did)
 * O = opinion (preference with confidence)
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";
import type { Message } from "./transcript";
import { extractContent } from "./transcript";

export type NoteType = "W" | "B" | "O";

export interface RelationshipNote {
  type: NoteType;
  text: string;
  confidence?: number;
}

const PREFERENCE_RE =
  /\b(prefer|like to|appreciate|love|enjoy|hate|dislike|don't like|do not like)\b/i;
const FRUSTRATION_RE =
  /\b(frustrat|annoy|irritat|wrong|broken|doesn't work|not working)\b/i;
const POSITIVE_RE = /\b(great|awesome|perfect|excellent|love it|well done|nice|thank)\b/i;
const MILESTONE_RE =
  /\b(first time|breakthrough|finally|success|got it working|managed to)\b/i;
const AI_ACTION_RE =
  /\b(I (wrote|created|refactored|added|fixed|updated|removed|implemented|built|changed))\b/i;

function isTrivial(s: string): boolean {
  return s.length < 15 || s.length > 250;
}

/** Analyze messages and extract relationship notes */
export function analyzeTranscript(messages: Message[]): RelationshipNote[] {
  const notes: RelationshipNote[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    const text = extractContent(msg);
    if (!text) continue;

    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (isTrivial(s)) continue;

      const key = s.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);

      if (msg.role === "user") {
        if (PREFERENCE_RE.test(s)) {
          notes.push({ type: "O", text: s.slice(0, 200), confidence: 0.75 });
        } else if (FRUSTRATION_RE.test(s)) {
          notes.push({ type: "O", text: s.slice(0, 200), confidence: 0.8 });
        } else if (POSITIVE_RE.test(s)) {
          notes.push({ type: "W", text: s.slice(0, 200) });
        } else if (MILESTONE_RE.test(s)) {
          notes.push({ type: "W", text: s.slice(0, 200) });
        }
      } else if (msg.role === "assistant") {
        if (AI_ACTION_RE.test(s)) {
          notes.push({ type: "B", text: s.slice(0, 200) });
        }
      }

      if (notes.length >= 8) return notes;
    }
  }

  return notes;
}

function dailyFilePath(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const monthDir = ensureDir(resolve(paths.relationship(), `${yyyy}-${mm}`));
  return resolve(monthDir, `${yyyy}-${mm}-${dd}.md`);
}

/** Append notes to today's relationship file */
export function appendNotes(notes: RelationshipNote[]): void {
  if (notes.length === 0) return;

  const filepath = dailyFilePath(new Date());
  const today = new Date().toISOString().slice(0, 10);

  const lines: string[] = [];

  if (!existsSync(filepath)) {
    lines.push(`# Relationship Notes — ${today}`, "");
  }

  const timestamp = new Date().toTimeString().slice(0, 5);
  lines.push(`## ${timestamp}`);

  for (const note of notes) {
    if (note.type === "O" && note.confidence !== undefined) {
      lines.push(`- O(c=${note.confidence}): ${note.text}`);
    } else {
      lines.push(`- ${note.type}: ${note.text}`);
    }
  }

  lines.push("");

  const existing = existsSync(filepath) ? readFileSync(filepath, "utf-8") : "";
  writeFileSync(filepath, existing + lines.join("\n"), "utf-8");
}

/** Load notes from the last N days as a single string */
export function loadRecentNotes(days: number = 2): string {
  const relDir = paths.relationship();
  if (!existsSync(relDir)) return "";

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const sections: string[] = [];

  for (const monthDir of readdirSync(relDir).sort().reverse()) {
    const monthPath = resolve(relDir, monthDir);
    if (!existsSync(monthPath)) continue;

    let files: string[];
    try {
      files = readdirSync(monthPath)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();
    } catch {
      continue;
    }

    for (const file of files) {
      const dateStr = file.replace(".md", "");
      if (new Date(dateStr) < cutoff) continue;

      try {
        const content = readFileSync(resolve(monthPath, file), "utf-8").trim();
        if (content) sections.push(content);
      } catch {
        // skip unreadable files
      }
    }

    if (sections.length > 0) break; // only go back one month at most
  }

  return sections.join("\n\n---\n\n");
}
