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
import { hasFrontmatter, parse } from "./frontmatter";
import { logDebug } from "./log";
import { ensureDir, paths } from "./paths";

// ── Types ──

interface LearningEntry {
  source: string; // "failure:{slug}" or "learning:{filename}"
  text: string; // context or title+insights
  date: string; // YYYY-MM-DD
  principle: string; // candidate principle from inference
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
  emerging: PatternGroup[];
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

export function similarity(a: string, b: string): number {
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
          let context = "";
          let ts = "";
          let entryPrinciple = "";

          // Try capture.md (new format)
          const capturePath = resolve(monthDir, slug, "capture.md");
          if (existsSync(capturePath)) {
            try {
              const content = readFileSync(capturePath, "utf-8");
              const { meta } = parse<{
                context?: string;
                ts?: string;
                principle?: string;
              }>(content);
              context = meta.context || "";
              ts = (meta.ts as string) || "";
              entryPrinciple = meta.principle || "";
            } catch {
              /* fallback below */
            }
          }

          // DEPRECATED: legacy sentiment.json fallback — remove once old failures have capture.md
          if (!context) {
            const sentimentPath = resolve(monthDir, slug, "sentiment.json");
            if (!existsSync(sentimentPath)) continue;
            try {
              const sentiment = JSON.parse(readFileSync(sentimentPath, "utf-8"));
              context = sentiment.context || "";
              ts = sentiment.ts || "";
            } catch {
              continue;
            }
          }

          if (context.length >= MIN_TEXT_LENGTH) {
            entries.push({
              source: `failure:${slug}`,
              text: context.slice(0, 300),
              date: ts.slice(0, 10),
              principle: entryPrinciple,
            });
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
            let title = "";
            let insights = "";
            let entryPrinciple = "";

            if (hasFrontmatter(content)) {
              // New format
              const { meta, body } = parse<{
                title?: string;
                principle?: string;
              }>(content);
              title = meta.title || "";
              entryPrinciple = meta.principle || "";
              const insightsMatch = body.match(/## Insights\n([\s\S]*?)(?=\n##|$)/);
              insights = insightsMatch?.[1]?.trim() || "";
            } else {
              // DEPRECATED: legacy **Title:** format — remove once old learning files are migrated
              const titleMatch = content.match(/\*\*Title:\*\*\s*(.+)/);
              title = titleMatch?.[1] || "";
              const insightsMatch = content.match(/## Insights\n([\s\S]*?)(?=\n##|$)/);
              insights = insightsMatch?.[1]?.trim() || "";
            }

            const text = [title, insights].filter(Boolean).join(" ");
            if (text.length >= MIN_TEXT_LENGTH) {
              const dateMatch = file.match(/^(\d{8})/);
              const date = dateMatch
                ? `${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)}`
                : "";
              entries.push({
                source: `learning:${file}`,
                text: text.slice(0, 300),
                date,
                principle: entryPrinciple,
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

export const SIMILARITY_THRESHOLD = 0.35;
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
    // Use principle for matching if available, fall back to raw text
    const matchText = entry.principle || entry.text;
    let matched = false;
    for (const group of groups) {
      const groupText = group.entries[0]?.principle || group.pattern;
      if (similarity(matchText, groupText) >= SIMILARITY_THRESHOLD) {
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

  return groups.filter((g) => g.entries.length >= 2);
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

export function graduate(): GraduationResult {
  const state = readState();
  const failures = collectFailures();
  const learnings = collectLearnings();
  const all = [...failures, ...learnings];

  logDebug(
    "graduation",
    `Collected ${failures.length} failures, ${learnings.length} learnings`
  );

  const allGroups = groupPatterns(all);
  const candidates = allGroups.filter((g) => g.entries.length >= MIN_OCCURRENCES);
  const emerging = allGroups.filter((g) => g.entries.length === 2);
  const result: GraduationResult = {
    candidates,
    emerging,
    graduated: [],
    updated: [],
  };

  if (candidates.length === 0) {
    logDebug("graduation", "No patterns with 3+ occurrences found");
    state.lastRun = new Date().toISOString();
    writeState(state);
    return result;
  }

  // Report candidates — no auto-writing, user decides what to crystallize
  for (const group of candidates) {
    const principle = synthesizePrinciple(group);
    const sources = group.entries.map((e) => e.source);
    const confidence = Math.min(95, 60 + (group.entries.length - MIN_OCCURRENCES) * 10);

    result.graduated.push({
      pattern: principle,
      domain: group.domain,
      confidence,
      occurrences: group.entries.length,
      sources,
      graduatedAt: new Date().toISOString(),
    });
  }

  // Update lastRun to prevent re-running immediately
  state.lastRun = new Date().toISOString();
  writeState(state);

  logDebug(
    "graduation",
    `Found ${result.graduated.length} candidate(s) for manual crystallization`
  );

  return result;
}

// ── Threshold Check (for Stop hook) ──

const GRADUATION_INTERVAL_DAYS = 7;
const MIN_NEW_ENTRIES = 10;

export function shouldRunGraduation(): boolean {
  const state = readState();

  // Enough time passed since last run?
  let timeThreshold = false;
  if (!state.lastRun) {
    timeThreshold = true;
  } else {
    const daysSince =
      (Date.now() - new Date(state.lastRun).getTime()) / (1000 * 60 * 60 * 24);
    timeThreshold = daysSince >= GRADUATION_INTERVAL_DAYS;
  }

  // Enough new material?
  const failures = collectFailures();
  const learnings = collectLearnings();
  const graduatedSources = new Set(state.graduated.flatMap((g) => g.sources));
  const newEntries = [...failures, ...learnings].filter(
    (e) => !graduatedSources.has(e.source)
  ).length;
  const entryThreshold = newEntries >= MIN_NEW_ENTRIES;

  // Run if either condition is met
  return timeThreshold || entryThreshold;
}
