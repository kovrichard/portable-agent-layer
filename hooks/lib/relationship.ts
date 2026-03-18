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

// Only match user messages where the user is expressing a personal preference/feeling.
// These require first-person framing to avoid matching technical descriptions.
const PREFERENCE_RE =
  /\b(I\s+(?:prefer|like to|appreciate|love|enjoy|hate|dislike|don't like|do not like))\b/i;
const FRUSTRATION_RE =
  /\b(I'm\s+(?:frustrat|annoy|irritat)|this\s+is\s+(?:frustrat|annoy)|stop\s+doing|don't\s+do\s+that)\b/i;
const POSITIVE_RE =
  /\b(I\s+(?:love it|like (?:this|that|it))|(?:great|awesome|perfect|excellent)\s+(?:job|work)|well\s+done|thanks?(?:\s+you)?[!.])\b/i;
const MILESTONE_RE =
  /\b(first time|breakthrough|finally\s+(?:got|works|working|done)|managed to)\b/i;

/** Skip sentences that look like code, errors, or technical descriptions */
function isTechnical(s: string): boolean {
  // Code artifacts: paths, backticks, camelCase, function calls, stack traces
  if (/[`{}()[\]]/.test(s)) return true;
  if (/(?:\/[\w.-]+){2,}/.test(s)) return true; // file paths
  if (/\b[a-z]+[A-Z][a-zA-Z]*\b/.test(s)) return true; // camelCase
  if (/\b\w+\.\w+\(/.test(s)) return true; // method calls
  if (/error|exception|stack|trace|stderr|stdout/i.test(s)) return true;
  if (/^\*\*/.test(s)) return true; // markdown bold (usually structured output)
  return false;
}

function isTrivial(s: string): boolean {
  return s.length < 20 || s.length > 200;
}

/** Analyze USER messages only for relationship signals */
export function analyzeTranscript(messages: Message[]): RelationshipNote[] {
  const notes: RelationshipNote[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    // Only analyze user messages — assistant output is not relationship signal
    if (msg.role !== "user") continue;

    const text = extractContent(msg);
    if (!text) continue;

    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (isTrivial(s)) continue;
      if (isTechnical(s)) continue;

      const key = s.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      if (PREFERENCE_RE.test(s)) {
        notes.push({ type: "O", text: s.slice(0, 200), confidence: 0.75 });
      } else if (FRUSTRATION_RE.test(s)) {
        notes.push({ type: "O", text: s.slice(0, 200), confidence: 0.8 });
      } else if (POSITIVE_RE.test(s)) {
        notes.push({ type: "W", text: s.slice(0, 200) });
      } else if (MILESTONE_RE.test(s)) {
        notes.push({ type: "W", text: s.slice(0, 200) });
      }

      if (notes.length >= 5) return notes;
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

/** Check if a session already has notes in today's file */
export function hasSessionNotes(sessionId: string): boolean {
  const filepath = dailyFilePath(new Date());
  if (!existsSync(filepath)) return false;
  try {
    const content = readFileSync(filepath, "utf-8");
    return content.includes(`<!-- session:${sessionId} -->`);
  } catch {
    return false;
  }
}

/** Deduplicate notes against what's already in today's file */
function dedup(notes: RelationshipNote[], filepath: string): RelationshipNote[] {
  if (!existsSync(filepath)) return notes;
  try {
    const existing = readFileSync(filepath, "utf-8").toLowerCase();
    return notes.filter((n) => {
      // Check if a substantially similar line already exists
      const key = n.text.slice(0, 80).toLowerCase();
      return !existing.includes(key);
    });
  } catch {
    return notes;
  }
}

/** Append notes to today's relationship file */
export function appendNotes(notes: RelationshipNote[], sessionId?: string): void {
  if (notes.length === 0) return;

  const filepath = dailyFilePath(new Date());
  const today = new Date().toISOString().slice(0, 10);

  // Deduplicate against existing content
  const fresh = dedup(notes, filepath);
  if (fresh.length === 0) return;

  const lines: string[] = [];

  if (!existsSync(filepath)) {
    lines.push(`# Relationship Notes — ${today}`, "");
  }

  const timestamp = new Date().toTimeString().slice(0, 5);
  lines.push(`## ${timestamp}`);
  if (sessionId) lines.push(`<!-- session:${sessionId} -->`);

  for (const note of fresh) {
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
