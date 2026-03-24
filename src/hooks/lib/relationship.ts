/**
 * Relationship Memory — daily interaction notes tracking preferences,
 * frustrations, positive signals, and milestones.
 *
 * Notes live at memory/relationship/YYYY-MM/YYYY-MM-DD.md
 * W = world (facts about user's situation)
 * O = opinion (preference with confidence)
 * B = biographical (what the AI did this session, first-person)
 *
 * Extraction is handled by the relationship handler via Haiku inference.
 * This lib provides storage and reading utilities only.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";

export type NoteType = "W" | "O" | "B";

export interface RelationshipNote {
  type: NoteType;
  text: string;
  confidence?: number;
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
      lines.push(`- ${note.type}(c=${note.confidence}): ${note.text}`);
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
    if (!/^\d{4}-\d{2}$/.test(monthDir)) continue;
    const monthPath = resolve(relDir, monthDir);

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
