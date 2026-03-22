/**
 * Tag vocabulary management for semantic grouping.
 *
 * Tags come from a fixed vocabulary. When Haiku suggests a tag not in the
 * vocabulary, it's tracked as "suggested". Suggested tags that recur 3+
 * times get auto-promoted to the vocabulary.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, paths } from "./paths";

const DEFAULT_VOCABULARY = [
  "versioning",
  "testing",
  "deployment",
  "configuration",
  "communication",
  "documentation",
  "architecture",
  "debugging",
  "performance",
  "security",
  "cross-platform",
  "dependencies",
  "incomplete-work",
  "wrong-approach",
  "tooling",
];

const PROMOTION_THRESHOLD = 3;

export interface TagState {
  vocabulary: string[];
  suggested: Record<string, number>;
}

function stateFilePath(): string {
  return resolve(ensureDir(paths.wisdomState()), "tags.json");
}

export function readTagState(): TagState {
  const fp = stateFilePath();
  if (!existsSync(fp)) {
    return { vocabulary: [...DEFAULT_VOCABULARY], suggested: {} };
  }
  try {
    return JSON.parse(readFileSync(fp, "utf-8"));
  } catch {
    return { vocabulary: [...DEFAULT_VOCABULARY], suggested: {} };
  }
}

export function writeTagState(state: TagState): void {
  writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), "utf-8");
}

/** Get the current vocabulary (for injection into inference prompts). */
export function getVocabulary(): string[] {
  return readTagState().vocabulary;
}

/**
 * Record a suggested tag. If it reaches the promotion threshold,
 * move it to the vocabulary automatically.
 */
export function recordSuggestedTag(tag: string): void {
  const state = readTagState();
  const normalized = tag.toLowerCase().trim();

  // Already in vocabulary — nothing to do
  if (state.vocabulary.includes(normalized)) return;

  // Increment suggestion count
  state.suggested[normalized] = (state.suggested[normalized] || 0) + 1;

  // Promote if threshold reached
  if (state.suggested[normalized] >= PROMOTION_THRESHOLD) {
    state.vocabulary.push(normalized);
    delete state.suggested[normalized];
  }

  writeTagState(state);
}

/** Get suggested tags and their counts (for reporting). */
export function getPendingSuggestions(): Record<string, number> {
  return readTagState().suggested;
}
