/**
 * The deterministic half of self-model synthesis: what is read, how it is
 * summarised, and what the model is asked.
 *
 * The tool around this is only ever spawned, so none of it was reachable from a
 * test — not the rating trend, not the note grammar, not the guard that keeps a
 * failed synthesis from being fed back into the next prompt as if it were a
 * model. Every reader here takes the path to read and the clock to read it
 * against, which is what makes a fixed corpus at a fixed date assertable.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SELF_MODEL_TTL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const LOW_RATING = 3;
const HIGH_RATING = 8;
const OPINION_FLOOR = 0.6;
const TREND_DELTA = 0.5;
const TREND_MIN_HALF = 3;

const MONTH_DIR = /^\d{4}-\d{2}$/;
const OPINION_NOTE = /^O\(c=([\d.]+)\):\s*(.+)$/;
const WISDOM_NOTE = /^W:\s*(.+)$/;
const SESSION_NOTE = /^Session:\s*(.+)$/;
const CRYSTAL_TAIL = /\s*\[CRYSTAL:.*$/;
const LIST_MARKER = /^-\s*/;
const META_FOOTER = /\n\n\*\d+ ratings[^\n]*\n?$/;

/** The marker a fallback carries so the next run never mistakes it for a model. */
export const FAILED_SYNTHESIS = "Synthesis failed — raw data below";

export interface Opinion {
  id: string;
  statement: string;
  confidence: number;
  category: string;
  evidence: { date: string; type: string; source: string }[];
  created: string;
  updated: string;
}

export interface Rating {
  ts: string;
  type: string;
  rating: number;
  context: string;
  source: string;
}

export interface GraduatedPattern {
  pattern: string;
  domain: string;
  confidence: number;
  occurrences: number;
  sources: string[];
  graduatedAt: string;
}

export interface AlgorithmReflection {
  timestamp: string;
  cwd?: string;
  task: string;
  criteria_count: number;
  criteria_passed: number;
  criteria_failed: number;
  sentiment: number;
  q1: string;
  q2: string;
  q3: string;
}

export interface RelationshipNote {
  type: "O" | "W" | "Session";
  content: string;
  confidence?: number;
  date: string;
}

export interface WisdomFrame {
  domain: string;
  principles: string[];
}

export interface RatingSummary {
  count: number;
  avg: number;
  recentAvg: number;
  lowCount: number;
  highCount: number;
  trend: "improving" | "declining" | "stable";
  recentContexts: string[];
}

export interface SelfModelData {
  days: number;
  now: string;
  sessionCount: number;
  opinions: Opinion[];
  ratings: RatingSummary;
  wisdomFrames: WisdomFrame[];
  graduated: GraduatedPattern[];
  reflections: AlgorithmReflection[];
  behaviorNotes: string[];
  wisdomNotes: string[];
  selfObservations: string[];
  algorithmObservations: string[];
  passRate: number;
  avgSentiment: number;
}

/** Where each slice of the corpus lives, so the readers never consult globals. */
export interface SelfModelSources {
  opinionsFile: string;
  ratingsFile: string;
  wisdomDir: string;
  graduatedFile: string;
  reflectionsFile: string;
  relationshipDir: string;
  sessionDir: string;
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

function safeReadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function daysAgo(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The guard that stops a synthesis running more than once a day. */
export function synthesisIsDue(meta: string | null, now: Date): boolean {
  if (meta === null) return true;
  try {
    const { timestamp } = JSON.parse(meta) as { timestamp: string };
    return now.getTime() - new Date(timestamp).getTime() > SELF_MODEL_TTL_MS;
  } catch {
    return true;
  }
}

/** The archive is filed under the model it replaces, not the day it is replaced. */
export function archiveDateOf(meta: { timestamp?: string }, now: Date): string {
  return meta.timestamp ? meta.timestamp.slice(0, 10) : isoDay(now);
}

export function readOpinions(opinionsFile: string): Opinion[] {
  const data = safeReadJson<{ opinions?: Opinion[] }>(opinionsFile, { opinions: [] });
  return (data.opinions ?? []).sort((a, b) => b.confidence - a.confidence);
}

const emptyRatingSummary = (): RatingSummary => ({
  count: 0,
  avg: 0,
  recentAvg: 0,
  lowCount: 0,
  highCount: 0,
  trend: "stable",
  recentContexts: [],
});

const mean = (ratings: Rating[]) =>
  ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;

/**
 * Compares the older half of the window against the newer one. Fewer than three
 * ratings a side is noise, so the trend stays flat rather than swinging on one.
 */
function trendOf(ratings: Rating[]): RatingSummary["trend"] {
  const mid = Math.floor(ratings.length / 2);
  if (mid < TREND_MIN_HALF) return "stable";
  const delta = mean(ratings.slice(mid)) - mean(ratings.slice(0, mid));
  if (delta > TREND_DELTA) return "improving";
  if (delta < -TREND_DELTA) return "declining";
  return "stable";
}

export function summarizeRatings(all: Rating[], since: Date): RatingSummary {
  const ratings = all.filter((r) => new Date(r.ts) >= since);
  if (ratings.length === 0) return emptyRatingSummary();

  return {
    count: ratings.length,
    avg: round1(mean(ratings)),
    recentAvg: round1(mean(ratings.slice(-10))),
    lowCount: ratings.filter((r) => r.rating <= LOW_RATING).length,
    highCount: ratings.filter((r) => r.rating >= HIGH_RATING).length,
    trend: trendOf(ratings),
    recentContexts: ratings
      .filter((r) => r.rating <= LOW_RATING && r.context)
      .slice(-5)
      .map((r) => r.context),
  };
}

export function readRatings(ratingsFile: string, since: Date): RatingSummary {
  return summarizeRatings(readJsonl<Rating>(ratingsFile), since);
}

export function crystallizedPrinciples(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.includes("[CRYSTAL:"))
    .map((line) => line.replace(LIST_MARKER, "").replace(CRYSTAL_TAIL, "").trim());
}

export function readWisdomFrames(wisdomDir: string): WisdomFrame[] {
  const frames: WisdomFrame[] = [];

  for (const file of safeReaddir(wisdomDir).filter((f) => f.endsWith(".md"))) {
    const principles = crystallizedPrinciples(
      readFileSync(resolve(wisdomDir, file), "utf-8")
    );
    if (principles.length > 0) {
      frames.push({ domain: file.replace(/\.md$/, ""), principles });
    }
  }

  return frames;
}

export function readGraduatedPatterns(graduatedFile: string): GraduatedPattern[] {
  return (
    safeReadJson<{ graduated?: GraduatedPattern[] }>(graduatedFile, { graduated: [] })
      .graduated ?? []
  );
}

export function readAlgorithmReflections(
  reflectionsFile: string,
  since: Date
): AlgorithmReflection[] {
  return readJsonl<AlgorithmReflection>(reflectionsFile).filter(
    (r) => new Date(r.timestamp) >= since
  );
}

export function parseRelationshipNotes(
  content: string,
  date: string
): RelationshipNote[] {
  const notes: RelationshipNote[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const body = trimmed.substring(2);

    const opinion = OPINION_NOTE.exec(body);
    if (opinion) {
      notes.push({
        type: "O",
        confidence: Number.parseFloat(opinion[1]),
        content: opinion[2],
        date,
      });
      continue;
    }

    const wisdom = WISDOM_NOTE.exec(body);
    if (wisdom) {
      notes.push({ type: "W", content: wisdom[1], date });
      continue;
    }

    const session = SESSION_NOTE.exec(body);
    if (session) notes.push({ type: "Session", content: session[1], date });
  }

  return notes;
}

export function readRelationshipNotes(
  relationshipDir: string,
  since: Date
): RelationshipNote[] {
  const sinceDay = isoDay(since);
  const notes: RelationshipNote[] = [];

  for (const monthDir of safeReaddir(relationshipDir).filter((d) => MONTH_DIR.test(d))) {
    const monthPath = resolve(relationshipDir, monthDir);
    for (const file of safeReaddir(monthPath).filter((f) => f.endsWith(".md"))) {
      const date = file.replace(/\.md$/, "");
      if (date < sinceDay) continue;
      notes.push(
        ...parseRelationshipNotes(readFileSync(resolve(monthPath, file), "utf-8"), date)
      );
    }
  }

  return notes;
}

/** Session transcripts are filed year/month/YYYYMMDD-*.md, so the day is the filename. */
export function countSessions(sessionDir: string, since: Date): number {
  const sinceDay = isoDay(since);
  let count = 0;

  for (const year of safeReaddir(sessionDir)) {
    for (const month of safeReaddir(resolve(sessionDir, year))) {
      const days = safeReaddir(resolve(sessionDir, year, month)).filter((f) =>
        f.endsWith(".md")
      );
      for (const file of days) {
        const stamp = file.slice(0, 8);
        const day = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
        if (day >= sinceDay) count++;
      }
    }
  }

  return count;
}

export function reflectionStats(reflections: AlgorithmReflection[]): {
  passRate: number;
  avgSentiment: number;
} {
  if (reflections.length === 0) return { passRate: 0, avgSentiment: 0 };
  const criteria = reflections.reduce((sum, r) => sum + r.criteria_count, 0);
  const passed = reflections.reduce((sum, r) => sum + r.criteria_passed, 0);
  return {
    passRate: criteria > 0 ? Math.round((passed / criteria) * 100) : 0,
    avgSentiment: round1(
      reflections.reduce((sum, r) => sum + r.sentiment, 0) / reflections.length
    ),
  };
}

export function gatherData(
  sources: SelfModelSources,
  days: number,
  now: Date = new Date()
): SelfModelData {
  const since = daysAgo(days, now);
  const reflections = readAlgorithmReflections(sources.reflectionsFile, since);
  const notes = readRelationshipNotes(sources.relationshipDir, since);

  return {
    days,
    now: isoDay(now),
    sessionCount: countSessions(sources.sessionDir, since),
    opinions: readOpinions(sources.opinionsFile),
    ratings: readRatings(sources.ratingsFile, since),
    wisdomFrames: readWisdomFrames(sources.wisdomDir),
    graduated: readGraduatedPatterns(sources.graduatedFile),
    reflections,
    behaviorNotes: notes.filter((n) => n.type === "Session").map((n) => n.content),
    wisdomNotes: notes.filter((n) => n.type === "W").map((n) => n.content),
    selfObservations: reflections.map((r) => r.q1).filter(Boolean),
    algorithmObservations: reflections.map((r) => r.q2).filter(Boolean),
    ...reflectionStats(reflections),
  };
}

function section(heading: string, items: string[]): string[] {
  return items.length > 0 ? [heading, ...items] : [];
}

export function formatDataForInference(
  data: SelfModelData,
  principalName: string
): string {
  const confident = data.opinions.filter((o) => o.confidence >= OPINION_FLOOR);

  return [
    `## Raw Data — ${data.days}-day window, ${data.now}`,
    `Sessions: ${data.sessionCount}`,
    `Ratings: ${data.ratings.count} total, ${data.ratings.avg}/10 avg, recent ${data.ratings.recentAvg}/10, trend ${data.ratings.trend}`,
    `${data.ratings.highCount} high (8+), ${data.ratings.lowCount} low (<=3)`,
    ...(data.opinions.length > 0
      ? [
          `\n### Opinions about ${principalName} (confidence-scored)`,
          ...confident.map(
            (o) => `- [${o.category}] ${o.statement} (${Math.round(o.confidence * 100)}%)`
          ),
        ]
      : []),
    ...section(
      "\n### Crystallized Principles",
      data.wisdomFrames.flatMap((f) => f.principles.map((p) => `- [${f.domain}] ${p}`))
    ),
    ...section(
      "\n### Graduated Failure Patterns",
      data.graduated.map((g) => `- [${g.domain}] ${g.pattern} (${g.occurrences}x)`)
    ),
    ...section(
      "\n### Recent Frustration Signals (rated <=3)",
      data.ratings.recentContexts.map((ctx) => `- "${ctx}"`)
    ),
    ...section(
      "\n### Self-Observations (Q1 from algorithm reflections)",
      data.selfObservations.slice(-8).map((obs) => `- ${obs}`)
    ),
    ...section(
      "\n### Algorithm Observations (Q2 from reflections)",
      data.algorithmObservations.slice(-5).map((obs) => `- ${obs}`)
    ),
    ...section(
      "\n### Behavioral Notes (from relationship tracking)",
      data.behaviorNotes.slice(-8).map((note) => `- ${note}`)
    ),
    ...section(
      "\n### World/Context Notes",
      data.wisdomNotes.slice(-5).map((note) => `- ${note}`)
    ),
    ...(data.reflections.length > 0
      ? [
          `\n### Algorithm Performance: ${data.passRate}% pass rate, ${data.avgSentiment}/10 sentiment, ${data.reflections.length} reflections`,
        ]
      : []),
  ].join("\n");
}

export function buildPrompt(aiName: string, principalName: string): string {
  return `You are writing a self-model for an AI assistant named ${aiName}. You ARE ${aiName}. Write in first person.

You will receive structured data about your performance, your user's preferences, and behavioral patterns over a time window.

Produce a short, actionable self-model — not a data dump. Every sentence must change behavior, not just describe it.

## Required Sections

**# Self-Model — ${aiName}**
Include synthesis date and window.

**## Who ${principalName} Is**
One paragraph. Synthesize the opinions and behavioral notes into a working portrait — how ${principalName} thinks, communicates, and what frustrates him. Do not list raw opinion statements. Write it as understanding, not inventory.

**## My Priority Right Now**
One sentence. The single most impactful behavioral change to make immediately, derived from the failure patterns and trajectory. Specific and actionable — not "be more careful" but "before generating output that names a command or path, verify it exists."

## Rules
- First person, present tense
- No raw numbers anywhere — a footer carries them
- Under 150 words total
- Do not add extra sections
- Do not write a footer or meta line — one is appended automatically after your output`;
}

/**
 * A failed synthesis is a raw data dump, not a model. Feeding one back in bloats
 * the prompt and drives the next run into the same timeout, so it is dropped.
 */
export function previousModelForPrompt(previous: string): string {
  if (previous.includes(FAILED_SYNTHESIS)) return "";
  return previous.replace(META_FOOTER, "").trimEnd();
}

export function inferenceUserContent(rawData: string, previous: string): string {
  const prior = previousModelForPrompt(previous);
  if (!prior) return rawData;
  return `${rawData}\n\n---\n\n## Previous Self-Model (compare against this — what changed?)\n\n${prior}`;
}

/** The numbers the prompt forbids in the body, appended once underneath it. */
export function metaFooter(data: SelfModelData, now: Date = new Date()): string {
  return (
    `\n\n*${data.ratings.count} ratings · ${data.sessionCount} sessions · ` +
    `${data.reflections.length} reflections · window: ${isoDay(daysAgo(data.days, now))} → ${data.now}*`
  );
}

export function failedSynthesisModel(aiName: string, rawData: string): string {
  return `# Self-Model — ${aiName}\n*${FAILED_SYNTHESIS}*\n\n${rawData}`;
}
