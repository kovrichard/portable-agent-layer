/**
 * Unified Learning Analysis — graduation + ratings summary in one pipeline.
 *
 * Reads failures and session learnings via learning-store, detects recurring
 * patterns via Dice similarity on context text, and generates a ratings summary
 * with recommendations via Haiku inference.
 *
 * A pattern qualifies for graduation when it appears 3+ times across different sessions.
 * Confidence starts at 60% and increases by 10% per additional occurrence (capped at 95%).
 * At 85%+, the entry gets the [CRYSTAL: N%] tag and is loaded every session.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasApiKey } from "./inference";
import {
  type FailureEntry,
  type LearningEntry,
  readFailures,
  readLearnings,
} from "./learning-store";
import { logDebug } from "./log";
import { ensureDir, paths } from "./paths";
import { extractKeywords, similarity } from "./text-similarity";

// ── Types ──

interface AnalysisEntry {
  source: string;
  path: string;
  text: string;
  date: string;
}

interface PatternGroup {
  pattern: string;
  entries: AnalysisEntry[];
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

interface RatingsSummary {
  total: number;
  average: number;
  low: { count: number; examples: string[] };
  high: { count: number; examples: string[] };
}

export interface AnalysisResult {
  candidates: PatternGroup[];
  emerging: PatternGroup[];
  graduated: GraduatedEntry[];
  ratings: RatingsSummary | null;
  recommendations: string[];
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

// ── Data Collection ──

const MIN_TEXT_LENGTH = 30;
export const SIMILARITY_THRESHOLD = 0.3;
const MIN_OCCURRENCES = 3;

function toAnalysisEntries(
  failures: FailureEntry[],
  learnings: LearningEntry[]
): AnalysisEntry[] {
  const entries: AnalysisEntry[] = [];

  for (const f of failures) {
    if (f.context.length >= MIN_TEXT_LENGTH) {
      entries.push({
        source: `failure:${f.slug}`,
        path: f.path,
        text: f.context.slice(0, 300),
        date: f.date,
      });
    }
  }

  for (const l of learnings) {
    const text = [l.title, l.insights].filter(Boolean).join(" ");
    if (text.length >= MIN_TEXT_LENGTH) {
      entries.push({
        source: `learning:${l.filename}`,
        path: l.path,
        text: text.slice(0, 300),
        date: l.date,
      });
    }
  }

  return entries;
}

// ── Pattern Grouping ──

function isActionable(text: string): boolean {
  const trimmed = text.trim();
  if (/\?[\s]*$/.test(trimmed)) return false;
  if (extractKeywords(trimmed).size < 4) return false;
  return true;
}

function groupPatterns(entries: AnalysisEntry[]): PatternGroup[] {
  const groups: PatternGroup[] = [];
  const actionable = entries.filter((e) => isActionable(e.text));

  for (const entry of actionable) {
    const matchText = entry.text;
    let matched = false;

    for (const group of groups) {
      const groupText = group.entries[0]?.text || group.pattern;
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

// ── Ratings Summary ──

interface RatingLine {
  rating: number;
  context: string;
  source: string;
}

function loadRatings(): RatingLine[] {
  try {
    const file = resolve(paths.signals(), "ratings.jsonl");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as RatingLine;
        } catch {
          return null;
        }
      })
      .filter((r): r is RatingLine => r !== null);
  } catch {
    return [];
  }
}

function summarizeRatings(ratings: RatingLine[]): RatingsSummary | null {
  if (ratings.length === 0) return null;

  const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
  const low = ratings.filter((r) => r.rating <= 4);
  const high = ratings.filter((r) => r.rating >= 7);

  return {
    total: ratings.length,
    average: avg,
    low: {
      count: low.length,
      examples: low.slice(-3).map((r) => r.context?.slice(0, 80) || ""),
    },
    high: {
      count: high.length,
      examples: high.slice(-3).map((r) => r.context?.slice(0, 80) || ""),
    },
  };
}

async function generateRecommendations(
  candidates: PatternGroup[],
  ratings: RatingsSummary | null
): Promise<string[]> {
  if (candidates.length === 0 && !ratings) return [];
  if (!hasApiKey()) {
    return candidates
      .slice(0, 3)
      .map(
        (c) => `Address "${c.pattern.slice(0, 80)}" (${c.entries.length} occurrences)`
      );
  }

  try {
    const { inference } = await import("./inference");

    const context = [
      ratings
        ? `Average rating: ${ratings.average.toFixed(1)}/10 (${ratings.total} total)`
        : "",
      ratings
        ? `Low ratings (≤4): ${ratings.low.count} | High ratings (≥7): ${ratings.high.count}`
        : "",
      "",
      candidates.length > 0 ? "Recurring patterns:" : "",
      ...candidates
        .slice(0, 5)
        .map((c) => `- [${c.domain}] ${c.entries.length}x: ${c.pattern.slice(0, 100)}`),
    ]
      .filter(Boolean)
      .join("\n");

    const result = await inference({
      system:
        "Generate 3-5 specific, actionable recommendations based on recurring AI assistant interaction patterns. Each must reference a concrete pattern from the data. One sentence each. Return a JSON object with a recommendations array.",
      user: context,
      maxTokens: 300,
      timeout: 15000,
      jsonSchema: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          recommendations: {
            type: "array" as const,
            items: { type: "string" as const },
          },
        },
        required: ["recommendations"],
      },
    });

    if (result.success && result.output) {
      const parsed = JSON.parse(result.output) as { recommendations: string[] };
      if (parsed.recommendations?.length > 0) return parsed.recommendations.slice(0, 5);
    }
  } catch {
    /* fallback below */
  }

  return candidates
    .slice(0, 3)
    .map((c) => `Address "${c.pattern.slice(0, 80)}" (${c.entries.length} occurrences)`);
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

// ── Synthesize Principle ──

function synthesizePrinciple(group: PatternGroup): string {
  const sorted = [...group.entries].sort((a, b) => a.text.length - b.text.length);
  let principle = sorted[0].text;
  const firstSentence = new RegExp(/^[^.!?]+[.!?]?/).exec(principle);
  if (firstSentence) principle = firstSentence[0];
  if (principle.length > 120) principle = `${principle.slice(0, 117)}...`;
  return principle.trim();
}

// ── Main Analysis ──

interface AnalyzeOptions {
  /** Generate actionable recommendations via inference. Default: false (patterns only). */
  actionable?: boolean;
}

export async function analyze(opts: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const state = readState();
  const failures = readFailures(paths.failures());
  const learnings = readLearnings(paths.sessionLearning());
  const all = toAnalysisEntries(failures, learnings);

  logDebug(
    "analyze",
    `Collected ${failures.length} failures, ${learnings.length} learnings`
  );

  const allGroups = groupPatterns(all);
  const candidates = allGroups.filter((g) => g.entries.length >= MIN_OCCURRENCES);
  const emerging = allGroups.filter((g) => g.entries.length === 2);

  const ratings = summarizeRatings(loadRatings());
  const recommendations = opts.actionable
    ? await generateRecommendations(candidates, ratings)
    : [];

  const graduated: GraduatedEntry[] = [];
  for (const group of candidates) {
    graduated.push({
      pattern: synthesizePrinciple(group),
      domain: group.domain,
      confidence: Math.min(95, 60 + (group.entries.length - MIN_OCCURRENCES) * 10),
      occurrences: group.entries.length,
      sources: group.entries.map((e) => e.source),
      graduatedAt: new Date().toISOString(),
    });
  }

  state.lastRun = new Date().toISOString();
  writeState(state);

  logDebug("analyze", `${candidates.length} candidate(s), ${emerging.length} emerging`);

  return { candidates, emerging, graduated, ratings, recommendations };
}
