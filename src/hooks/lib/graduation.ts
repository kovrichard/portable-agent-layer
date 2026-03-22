/**
 * Wisdom Graduation Pipeline — promotes recurring patterns into permanent wisdom frames.
 *
 * Reads failures and session learnings, detects recurring patterns,
 * and graduates them into wisdom frames with confidence tracking.
 *
 * A pattern qualifies for graduation when it appears 3+ times across different sessions.
 * Confidence starts at 60% and increases by 10% per additional occurrence (capped at 95%).
 * At 85%+, the entry gets the [CRYSTAL: N%] tag and is loaded every session.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug } from "./log";
import { ensureDir, paths } from "./paths";

// ── Types ──

interface LearningEntry {
  source: string; // "failure:{slug}" or "learning:{filename}"
  text: string; // context or title+insights
  date: string; // YYYY-MM-DD
}

interface PatternGroup {
  pattern: string; // representative text
  entries: LearningEntry[];
  domain: string;
}

interface GraduatedEntry {
  pattern: string;
  domain: string;
  confidence: number;
  occurrences: number;
  sources: string[];
  graduatedAt: string;
}

interface GraduationState {
  lastRun: string;
  graduated: GraduatedEntry[];
}

export interface GraduationResult {
  candidates: PatternGroup[];
  graduated: GraduatedEntry[];
  updated: GraduatedEntry[];
}

// ── Domain Classification ──

const DOMAIN_MAP: [RegExp, string][] = [
  [/code|test|hook|build|deploy|function|import|type|lint/i, "development"],
  [/commit|git|release|version|tag|branch|push|merge/i, "workflow"],
  [/tone|format|response|verbose|brief|summary|explain/i, "communication"],
  [/install|config|setup|env|path|directory/i, "infrastructure"],
  [/api|endpoint|request|token|auth/i, "integration"],
];

function classifyDomain(text: string): string {
  for (const [pattern, domain] of DOMAIN_MAP) {
    if (pattern.test(text)) return domain;
  }
  return "general";
}

// ── Pattern Similarity ──

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "shall",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "no",
  "so",
  "if",
  "then",
  "than",
  "that",
  "this",
  "it",
  "its",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "what",
  "which",
  "who",
  "when",
  "where",
  "how",
  "all",
  "each",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "up",
  "out",
  "about",
  "just",
  "also",
  "very",
  "too",
  "only",
  "own",
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function similarity(a: string, b: string): number {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.size === 0 || kb.size === 0) return 0;

  let intersection = 0;
  for (const w of ka) {
    if (kb.has(w)) intersection++;
  }
  const union = new Set([...ka, ...kb]).size;
  return union > 0 ? intersection / union : 0;
}

// ── Data Collection ──

function collectFailures(): LearningEntry[] {
  const entries: LearningEntry[] = [];
  const failuresDir = paths.failures();
  if (!existsSync(failuresDir)) return entries;

  try {
    for (const year of readdirSync(failuresDir)) {
      const yearDir = resolve(failuresDir, year);
      for (const month of readdirSync(yearDir)) {
        const monthDir = resolve(yearDir, month);
        for (const slug of readdirSync(monthDir)) {
          const sentimentPath = resolve(monthDir, slug, "sentiment.json");
          if (!existsSync(sentimentPath)) continue;
          try {
            const sentiment = JSON.parse(readFileSync(sentimentPath, "utf-8"));
            if (sentiment.context && sentiment.context.length >= MIN_TEXT_LENGTH) {
              entries.push({
                source: `failure:${slug}`,
                text: sentiment.context.slice(0, 300),
                date: sentiment.ts?.slice(0, 10) || "",
              });
            }
          } catch {
            /* skip corrupt files */
          }
        }
      }
    }
  } catch {
    /* non-critical */
  }

  return entries;
}

function collectLearnings(): LearningEntry[] {
  const entries: LearningEntry[] = [];
  const learningDir = paths.sessionLearning();
  if (!existsSync(learningDir)) return entries;

  try {
    for (const year of readdirSync(learningDir)) {
      const yearDir = resolve(learningDir, year);
      for (const month of readdirSync(yearDir)) {
        const monthDir = resolve(yearDir, month);
        for (const file of readdirSync(monthDir).filter((f) => f.endsWith(".md"))) {
          try {
            const content = readFileSync(resolve(monthDir, file), "utf-8");
            const titleMatch = content.match(/\*\*Title:\*\*\s*(.+)/);
            const insightsMatch = content.match(/## Insights\n([\s\S]*?)(?=\n##|$)/);
            const text = [titleMatch?.[1] || "", insightsMatch?.[1]?.trim() || ""]
              .filter(Boolean)
              .join(" ");
            if (text.length >= MIN_TEXT_LENGTH) {
              const dateMatch = file.match(/^(\d{8})/);
              const date = dateMatch
                ? `${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)}`
                : "";
              entries.push({
                source: `learning:${file}`,
                text: text.slice(0, 300),
                date,
              });
            }
          } catch {
            /* skip */
          }
        }
      }
    }
  } catch {
    /* non-critical */
  }

  return entries;
}

// ── Grouping ──

const SIMILARITY_THRESHOLD = 0.35;
const MIN_OCCURRENCES = 3;
const MIN_TEXT_LENGTH = 30;

/** Filter out entries that aren't actionable as wisdom (questions, greetings, etc.) */
function isActionable(text: string): boolean {
  const trimmed = text.trim();
  // Skip pure questions
  if (/\?[\s]*$/.test(trimmed)) return false;
  // Skip auto-captured boilerplate
  if (trimmed.includes("*Auto-captured")) return false;
  // Skip very short after cleanup
  if (extractKeywords(trimmed).size < 4) return false;
  return true;
}

function groupPatterns(entries: LearningEntry[]): PatternGroup[] {
  const groups: PatternGroup[] = [];
  const actionable = entries.filter((e) => isActionable(e.text));

  for (const entry of actionable) {
    let matched = false;
    for (const group of groups) {
      if (similarity(entry.text, group.pattern) >= SIMILARITY_THRESHOLD) {
        group.entries.push(entry);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.push({
        pattern: entry.text,
        entries: [entry],
        domain: classifyDomain(entry.text),
      });
    }
  }

  return groups.filter((g) => g.entries.length >= MIN_OCCURRENCES);
}

// ── State Management ──

function stateFilePath(): string {
  return resolve(ensureDir(paths.wisdomState()), "graduated.json");
}

function readState(): GraduationState {
  const fp = stateFilePath();
  if (!existsSync(fp)) return { lastRun: "", graduated: [] };
  try {
    return JSON.parse(readFileSync(fp, "utf-8"));
  } catch {
    return { lastRun: "", graduated: [] };
  }
}

function writeState(state: GraduationState): void {
  writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), "utf-8");
}

// ── Frame Writing ──

function appendToFrame(domain: string, principle: string, confidence: number): void {
  const framesDir = paths.wisdom();
  const framePath = resolve(framesDir, `${domain}.md`);

  const tag = confidence >= 85 ? ` [CRYSTAL: ${confidence}%]` : ` (${confidence}%)`;
  const line = `- ${principle}${tag}\n`;

  if (existsSync(framePath)) {
    const content = readFileSync(framePath, "utf-8");
    // Don't duplicate
    if (content.includes(principle)) return;
    writeFileSync(framePath, `${content.trimEnd()}\n${line}`, "utf-8");
  } else {
    writeFileSync(framePath, line, "utf-8");
  }
}

function updateFrameConfidence(
  domain: string,
  principle: string,
  newConfidence: number
): void {
  const framePath = resolve(paths.wisdom(), `${domain}.md`);
  if (!existsSync(framePath)) return;

  let content = readFileSync(framePath, "utf-8");
  // Match the principle with any existing tag
  const escaped = principle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^(- ${escaped})\\s*(?:\\[CRYSTAL: \\d+%\\]|\\(\\d+%\\))`,
    "m"
  );

  const tag =
    newConfidence >= 85 ? ` [CRYSTAL: ${newConfidence}%]` : ` (${newConfidence}%)`;

  if (pattern.test(content)) {
    content = content.replace(pattern, `$1${tag}`);
    writeFileSync(framePath, content, "utf-8");
  }
}

// ── Main Graduation Logic ──

/**
 * Summarize a pattern group into a concise principle statement.
 * Uses the most common keywords across all entries.
 */
function synthesizePrinciple(group: PatternGroup): string {
  // Use the shortest entry as the base (likely most concise)
  const sorted = [...group.entries].sort((a, b) => a.text.length - b.text.length);
  let principle = sorted[0].text;

  // Clean up: take first sentence, cap at 120 chars
  const firstSentence = principle.match(/^[^.!?]+[.!?]?/);
  if (firstSentence) principle = firstSentence[0];
  if (principle.length > 120) {
    principle = `${principle.slice(0, 117)}...`;
  }

  return principle.trim();
}

export function graduate(dryRun = false): GraduationResult {
  const state = readState();
  const failures = collectFailures();
  const learnings = collectLearnings();
  const all = [...failures, ...learnings];

  logDebug(
    "graduation",
    `Collected ${failures.length} failures, ${learnings.length} learnings`
  );

  const candidates = groupPatterns(all);
  const result: GraduationResult = {
    candidates,
    graduated: [],
    updated: [],
  };

  if (candidates.length === 0) {
    logDebug("graduation", "No patterns with 3+ occurrences found");
    if (!dryRun) {
      state.lastRun = new Date().toISOString();
      writeState(state);
    }
    return result;
  }

  for (const group of candidates) {
    const principle = synthesizePrinciple(group);
    const sources = group.entries.map((e) => e.source);
    const existing = state.graduated.find(
      (g) => similarity(g.pattern, principle) >= SIMILARITY_THRESHOLD
    );

    if (existing) {
      // Update existing — bump confidence
      const newOccurrences = group.entries.length;
      if (newOccurrences > existing.occurrences) {
        const bump = (newOccurrences - existing.occurrences) * 10;
        const newConfidence = Math.min(95, existing.confidence + bump);

        if (!dryRun) {
          existing.occurrences = newOccurrences;
          existing.confidence = newConfidence;
          existing.sources = sources;
          updateFrameConfidence(existing.domain, existing.pattern, newConfidence);
        }

        result.updated.push({
          ...existing,
          confidence: Math.min(95, existing.confidence + bump),
          occurrences: newOccurrences,
        });
      }
    } else {
      // New graduation
      const confidence = Math.min(95, 60 + (group.entries.length - MIN_OCCURRENCES) * 10);
      const entry: GraduatedEntry = {
        pattern: principle,
        domain: group.domain,
        confidence,
        occurrences: group.entries.length,
        sources,
        graduatedAt: new Date().toISOString(),
      };

      if (!dryRun) {
        appendToFrame(group.domain, principle, confidence);
        state.graduated.push(entry);
      }

      result.graduated.push(entry);
    }
  }

  if (!dryRun) {
    state.lastRun = new Date().toISOString();
    writeState(state);
    logDebug(
      "graduation",
      `Graduated ${result.graduated.length} new, updated ${result.updated.length} existing`
    );
  }

  return result;
}

// ── Threshold Check (for Stop hook) ──

const GRADUATION_INTERVAL_DAYS = 14;
const MIN_NEW_ENTRIES = 10;

export function shouldRunGraduation(): boolean {
  const state = readState();

  // Check time since last run
  if (state.lastRun) {
    const daysSince =
      (Date.now() - new Date(state.lastRun).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < GRADUATION_INTERVAL_DAYS) return false;
  }

  // Check if enough new material
  const failures = collectFailures();
  const learnings = collectLearnings();

  // Compare against graduated count to estimate new entries
  const graduatedSources = new Set(state.graduated.flatMap((g) => g.sources));
  const newEntries = [...failures, ...learnings].filter(
    (e) => !graduatedSources.has(e.source)
  ).length;

  return newEntries >= MIN_NEW_ENTRIES;
}
