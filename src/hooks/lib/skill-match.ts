/**
 * Skill matching — deterministic trigger lookup that names the skills a prompt
 * probably wants, injected at prompt time.
 *
 * A skill declares its own `metadata.triggers` in SKILL.md; `generateSkillIndex`
 * copies them into skill-index.json. Here the prompt and every trigger are
 * normalized the same way (lowercase, punctuation to spaces, space-padded), so a
 * plain substring test is already a whole-word test and multi-word phrases work
 * without a regex. Pure + fail-open, like the steering classifier it rides with.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";
import { isEnabled } from "./settings";

interface SkillIndexEntry {
  name: string;
  description: string;
  triggers?: string[];
}

export interface SkillIndex {
  skills: Record<string, SkillIndexEntry>;
}

export interface SkillMatch {
  name: string;
  description: string;
  score: number;
  matched: string[];
}

const MAX_MATCHES = 3;
const MAX_SKILL_BYTES = 700;
const MAX_DESCRIPTION_CHARS = 100;
const PHRASE_WEIGHT = 3;
const WORD_WEIGHT = 1;

/** Lowercase, punctuation to spaces, space-padded — so `includes` tests whole words. */
function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function readSkillIndex(): SkillIndex | null {
  const path = resolve(paths.state(), "skill-index.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SkillIndex;
  } catch {
    return null;
  }
}

function weightOf(trigger: string): number {
  return trigger.trim().includes(" ") ? PHRASE_WEIGHT : WORD_WEIGHT;
}

/** Rank the indexed skills whose triggers appear in the prompt, best first. */
export function matchSkills(prompt: string, index: SkillIndex): SkillMatch[] {
  const haystack = normalize(prompt);
  if (haystack.trim() === "") return [];

  const matches: SkillMatch[] = [];
  for (const entry of Object.values(index.skills ?? {})) {
    let score = 0;
    const matched: string[] = [];
    for (const trigger of entry.triggers ?? []) {
      const needle = normalize(trigger);
      if (needle.trim() === "" || !haystack.includes(needle)) continue;
      score += weightOf(needle);
      matched.push(trigger);
    }
    if (score > 0)
      matches.push({ name: entry.name, description: entry.description, score, matched });
  }

  return matches
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, MAX_MATCHES);
}

function summarize(description: string): string {
  if (description.length <= MAX_DESCRIPTION_CHARS) return description;
  return `${description.slice(0, MAX_DESCRIPTION_CHARS).trimEnd()}…`;
}

function line(match: SkillMatch): string {
  const matched = match.matched.map((trigger) => `"${trigger}"`).join(", ");
  return `- ${match.name} — ${summarize(match.description)} (matched: ${matched})`;
}

/** Build the skill-match <system-reminder> for a prompt, or null if nothing matches. */
export function getSkillReminder(prompt: string): string | null {
  if (!isEnabled("skillMatching")) return null;
  if (!prompt?.trim()) return null;

  const index = readSkillIndex();
  if (!index) return null;

  let matches: SkillMatch[];
  try {
    matches = matchSkills(prompt, index);
  } catch {
    return null; // fail-open: never block a prompt on a matcher error
  }
  if (matches.length === 0) return null;

  const lines: string[] = [];
  let budget = MAX_SKILL_BYTES;
  for (const match of matches) {
    const rendered = line(match);
    const cost = Buffer.byteLength(rendered);
    if (cost > budget) break; // byte-cap: drop the overflow tail, keep top matches
    lines.push(rendered);
    budget -= cost;
  }
  if (lines.length === 0) return null;

  return [
    "<system-reminder>",
    "Potential matching skills: these matched trigger words in your prompt. Invoke one with the Skill tool if it fits the request; ignore them if none do.",
    ...lines,
    "</system-reminder>",
  ].join("\n");
}
