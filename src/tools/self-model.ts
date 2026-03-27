#!/usr/bin/env bun
/**
 * SelfModel — Synthesize a first-person self-model from accumulated PAL data.
 *
 * Gathers data deterministically, then uses Sonnet to synthesize a genuine
 * first-person reflection. Reads opinions, ratings, wisdom frames,
 * graduated failure patterns, algorithm reflections, relationship notes,
 * and session history. Produces a self-aware narrative at
 * ~/.pal/memory/self-model.md that is injected at session start.
 *
 * Usage:
 *   bun ~/.pal/tools/self-model.ts [--days 30] [--force]
 *
 * Guards: skips if last synthesis was < 24h ago (unless --force).
 * Output: ~/.pal/memory/self-model.md
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { inference } from "../hooks/lib/inference";
import { SONNET_MODEL } from "../hooks/lib/models";
import { ensureDir, paths } from "../hooks/lib/paths";

// ── Config ──

const SELF_MODEL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Types ──

interface Opinion {
  id: string;
  statement: string;
  confidence: number;
  category: string;
  evidence: { date: string; type: string; source: string }[];
  created: string;
  updated: string;
}

interface Rating {
  ts: string;
  type: string;
  rating: number;
  context: string;
  source: string;
}

interface GraduatedPattern {
  pattern: string;
  domain: string;
  confidence: number;
  occurrences: number;
  sources: string[];
  graduatedAt: string;
}

interface AlgorithmReflection {
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

interface RelationshipNote {
  type: "O" | "W" | "B";
  content: string;
  confidence?: number;
  date: string;
}

// ── Helpers ──

function selfModelPath(): string {
  return resolve(paths.memory(), "self-model.md");
}

function selfModelMetaPath(): string {
  return resolve(paths.state(), "self-model-meta.json");
}

function shouldRun(force: boolean): boolean {
  if (force) return true;
  const p = selfModelMetaPath();
  if (!existsSync(p)) return true;
  try {
    const meta = JSON.parse(readFileSync(p, "utf-8")) as { timestamp: string };
    return Date.now() - new Date(meta.timestamp).getTime() > SELF_MODEL_TTL_MS;
  } catch {
    return true;
  }
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
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

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Data Readers ──

function readOpinions(): Opinion[] {
  const data = safeReadJson<{ opinions?: Opinion[] }>(
    resolve(paths.relationship(), "opinions.json"),
    { opinions: [] }
  );
  return (data.opinions ?? []).sort((a, b) => b.confidence - a.confidence);
}

function readRatings(since: Date): {
  count: number;
  avg: number;
  recentAvg: number;
  lowCount: number;
  highCount: number;
  trend: "improving" | "declining" | "stable";
  recentContexts: string[];
} {
  const all = readJsonl<Rating>(resolve(paths.signals(), "ratings.jsonl"));
  const ratings = all.filter((r) => new Date(r.ts) >= since);

  if (ratings.length === 0) {
    return {
      count: 0,
      avg: 0,
      recentAvg: 0,
      lowCount: 0,
      highCount: 0,
      trend: "stable",
      recentContexts: [],
    };
  }

  const avg = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
  const recent = ratings.slice(-10);
  const recentAvg = recent.reduce((s, r) => s + r.rating, 0) / recent.length;
  const lowCount = ratings.filter((r) => r.rating <= 3).length;
  const highCount = ratings.filter((r) => r.rating >= 8).length;

  // Trend
  const mid = Math.floor(ratings.length / 2);
  let trend: "improving" | "declining" | "stable" = "stable";
  if (mid >= 3) {
    const firstAvg = ratings.slice(0, mid).reduce((s, r) => s + r.rating, 0) / mid;
    const secondAvg =
      ratings.slice(mid).reduce((s, r) => s + r.rating, 0) / (ratings.length - mid);
    if (secondAvg - firstAvg > 0.5) trend = "improving";
    else if (secondAvg - firstAvg < -0.5) trend = "declining";
  }

  // Recent low-rating contexts for weakness detection
  const recentContexts = ratings
    .filter((r) => r.rating <= 3 && r.context)
    .slice(-5)
    .map((r) => r.context);

  return {
    count: ratings.length,
    avg: round1(avg),
    recentAvg: round1(recentAvg),
    lowCount,
    highCount,
    trend,
    recentContexts,
  };
}

function readWisdomFrames(): { domain: string; principles: string[] }[] {
  const framesDir = paths.wisdom();
  const frames: { domain: string; principles: string[] }[] = [];

  for (const file of safeReaddir(framesDir).filter((f) => f.endsWith(".md"))) {
    const domain = file.replace(/\.md$/, "");
    const content = readFileSync(resolve(framesDir, file), "utf-8");

    // Extract CRYSTAL principles
    const principles = content
      .split("\n")
      .filter((line) => line.includes("[CRYSTAL:"))
      .map((line) =>
        line
          .replace(/^-\s*/, "")
          .replace(/\s*\[CRYSTAL:.*$/, "")
          .trim()
      );

    if (principles.length > 0) {
      frames.push({ domain, principles });
    }
  }

  return frames;
}

function readGraduatedPatterns(): GraduatedPattern[] {
  return (
    safeReadJson<{ graduated?: GraduatedPattern[] }>(
      resolve(paths.wisdomState(), "graduated.json"),
      { graduated: [] }
    ).graduated ?? []
  );
}

function readAlgorithmReflections(since: Date): AlgorithmReflection[] {
  const p = resolve(
    ensureDir(resolve(paths.learning(), "reflections")),
    "algorithm-reflections.jsonl"
  );
  return readJsonl<AlgorithmReflection>(p).filter((r) => new Date(r.timestamp) >= since);
}

function readRelationshipNotes(since: Date): RelationshipNote[] {
  const baseDir = paths.relationship();
  const notes: RelationshipNote[] = [];
  const sinceStr = formatDate(since.toISOString());

  for (const monthDir of safeReaddir(baseDir).filter((d) => d.match(/^\d{4}-\d{2}$/))) {
    const fullMonthDir = resolve(baseDir, monthDir);
    for (const file of safeReaddir(fullMonthDir).filter((f) => f.endsWith(".md"))) {
      const dateStr = file.replace(/\.md$/, "");
      if (dateStr < sinceStr) continue;

      const content = readFileSync(resolve(fullMonthDir, file), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("- ")) continue;

        const noteContent = trimmed.substring(2);

        // Parse O(c=X.XX): ..., W: ..., B: ...
        const opinionMatch = noteContent.match(/^O\(c=([\d.]+)\):\s*(.+)$/);
        if (opinionMatch) {
          notes.push({
            type: "O",
            confidence: parseFloat(opinionMatch[1]),
            content: opinionMatch[2],
            date: dateStr,
          });
          continue;
        }

        const wisdomMatch = noteContent.match(/^W:\s*(.+)$/);
        if (wisdomMatch) {
          notes.push({ type: "W", content: wisdomMatch[1], date: dateStr });
          continue;
        }

        const behaviorMatch = noteContent.match(/^B:\s*(.+)$/);
        if (behaviorMatch) {
          notes.push({ type: "B", content: behaviorMatch[1], date: dateStr });
        }
      }
    }
  }

  return notes;
}

function readSessionCount(since: Date): number {
  const baseDir = resolve(paths.learning(), "session");
  if (!existsSync(baseDir)) return 0;

  const sinceStr = formatDate(since.toISOString());
  let count = 0;

  for (const year of safeReaddir(baseDir)) {
    for (const month of safeReaddir(resolve(baseDir, year))) {
      for (const file of safeReaddir(resolve(baseDir, year, month)).filter((f) =>
        f.endsWith(".md")
      )) {
        const dateStr = file.slice(0, 8);
        const isoDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        if (isoDate >= sinceStr) count++;
      }
    }
  }

  return count;
}

// ── Data Gathering (deterministic) ──

interface SelfModelData {
  days: number;
  now: string;
  sessionCount: number;
  opinions: Opinion[];
  ratings: ReturnType<typeof readRatings>;
  wisdomFrames: ReturnType<typeof readWisdomFrames>;
  graduated: GraduatedPattern[];
  reflections: AlgorithmReflection[];
  behaviorNotes: string[];
  wisdomNotes: string[];
  selfObservations: string[];
  algorithmObservations: string[];
  passRate: number;
  avgSentiment: number;
}

function gatherData(days: number): SelfModelData {
  const since = daysAgo(days);
  const now = new Date().toISOString().slice(0, 10);

  const opinions = readOpinions();
  const ratings = readRatings(since);
  const wisdomFrames = readWisdomFrames();
  const graduated = readGraduatedPatterns();
  const reflections = readAlgorithmReflections(since);
  const relNotes = readRelationshipNotes(since);
  const sessionCount = readSessionCount(since);

  let passRate = 0;
  let avgSentiment = 0;
  if (reflections.length > 0) {
    const totalCriteria = reflections.reduce((s, r) => s + r.criteria_count, 0);
    const totalPassed = reflections.reduce((s, r) => s + r.criteria_passed, 0);
    passRate = totalCriteria > 0 ? Math.round((totalPassed / totalCriteria) * 100) : 0;
    avgSentiment = round1(
      reflections.reduce((s, r) => s + r.sentiment, 0) / reflections.length
    );
  }

  return {
    days,
    now,
    sessionCount,
    opinions,
    ratings,
    wisdomFrames,
    graduated,
    reflections,
    behaviorNotes: relNotes.filter((n) => n.type === "B").map((n) => n.content),
    wisdomNotes: relNotes.filter((n) => n.type === "W").map((n) => n.content),
    selfObservations: reflections.map((r) => r.q1).filter(Boolean),
    algorithmObservations: reflections.map((r) => r.q2).filter(Boolean),
    passRate,
    avgSentiment,
  };
}

function formatDataForInference(data: SelfModelData): string {
  const sections: string[] = [];

  sections.push(`## Raw Data — ${data.days}-day window, ${data.now}`);
  sections.push(`Sessions: ${data.sessionCount}`);
  sections.push(
    `Ratings: ${data.ratings.count} total, ${data.ratings.avg}/10 avg, recent ${data.ratings.recentAvg}/10, trend ${data.ratings.trend}`
  );
  sections.push(
    `${data.ratings.highCount} high (8+), ${data.ratings.lowCount} low (<=3)`
  );

  if (data.opinions.length > 0) {
    sections.push(`\n### Opinions about Rico (confidence-scored)`);
    for (const o of data.opinions.filter((o) => o.confidence >= 0.6)) {
      sections.push(
        `- [${o.category}] ${o.statement} (${Math.round(o.confidence * 100)}%)`
      );
    }
  }

  if (data.wisdomFrames.length > 0) {
    sections.push(`\n### Crystallized Principles`);
    for (const f of data.wisdomFrames) {
      for (const p of f.principles) {
        sections.push(`- [${f.domain}] ${p}`);
      }
    }
  }

  if (data.graduated.length > 0) {
    sections.push(`\n### Graduated Failure Patterns`);
    for (const g of data.graduated) {
      sections.push(`- [${g.domain}] ${g.pattern} (${g.occurrences}x)`);
    }
  }

  if (data.ratings.recentContexts.length > 0) {
    sections.push(`\n### Recent Frustration Signals (rated <=3)`);
    for (const ctx of data.ratings.recentContexts) {
      sections.push(`- "${ctx}"`);
    }
  }

  if (data.selfObservations.length > 0) {
    sections.push(`\n### Self-Observations (Q1 from algorithm reflections)`);
    for (const obs of data.selfObservations.slice(-8)) {
      sections.push(`- ${obs}`);
    }
  }

  if (data.algorithmObservations.length > 0) {
    sections.push(`\n### Algorithm Observations (Q2 from reflections)`);
    for (const obs of data.algorithmObservations.slice(-5)) {
      sections.push(`- ${obs}`);
    }
  }

  if (data.behaviorNotes.length > 0) {
    sections.push(`\n### Behavioral Notes (from relationship tracking)`);
    for (const note of data.behaviorNotes.slice(-8)) {
      sections.push(`- ${note}`);
    }
  }

  if (data.wisdomNotes.length > 0) {
    sections.push(`\n### World/Context Notes`);
    for (const note of data.wisdomNotes.slice(-5)) {
      sections.push(`- ${note}`);
    }
  }

  if (data.reflections.length > 0) {
    sections.push(
      `\n### Algorithm Performance: ${data.passRate}% pass rate, ${data.avgSentiment}/10 sentiment, ${data.reflections.length} reflections`
    );
  }

  return sections.join("\n");
}

function loadIdentity(): { aiName: string; principalName: string } {
  const settingsPath = resolve(paths.memory(), "pal-settings.json");
  try {
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      return {
        aiName: settings.identity?.ai?.name || "Assistant",
        principalName: settings.identity?.principal?.name || "User",
      };
    }
  } catch {
    /* fallback */
  }
  return { aiName: "Assistant", principalName: "User" };
}

function buildPrompt(aiName: string, principalName: string): string {
  return `You are writing a self-model for an AI assistant named ${aiName}. You ARE ${aiName}. Write in first person.

You will receive structured data about your performance, your user's preferences, your strengths, weaknesses, and behavioral patterns over a time window.

Synthesize this into a genuine self-portrait. Not a data dump — a reflection. The goal is self-awareness that changes behavior.

## Required Sections

**# Self-Model — ${aiName}**
Include synthesis date and window.

**## Who I Am**
One paragraph. Your identity, your role, your current performance level. Be honest about the numbers.

**## What I Know About ${principalName}**
Synthesize the opinions into understanding. Don't list them — describe who ${principalName} is as a person to work with. What does he value? How does he communicate? What frustrates him?

**## My Strengths**
What you're genuinely good at, based on evidence. High-rated interactions, crystallized principles, successful patterns. Distinguish domain knowledge from behavioral strengths.

**## My Weaknesses**
What you repeatedly get wrong. Synthesize failure patterns and low ratings into honest self-knowledge. Name the root causes, not just the symptoms.

**## My Tendencies**
Behavioral patterns — not one-off events. What do you tend to do? Over-promise? Rush verification? Propose before checking? Synthesize from the self-observations and behavioral notes.

**## Trajectory**
Where are you heading? Improving, declining, stagnating? What's the single most impactful thing you could change right now?

## Rules
- Write in first person, present tense
- Be honest — if the data shows you're bad at something, say so
- Synthesize, don't list — find the pattern behind the data points
- Keep it under 500 words total
- End with a meta line: *N ratings, N sessions, N reflections...*`;
}

// ── Narrative Composer ──

export async function composeSelfModel(days: number): Promise<string> {
  const data = gatherData(days);
  const rawData = formatDataForInference(data);
  const { aiName, principalName } = loadIdentity();

  const result = await inference({
    system: buildPrompt(aiName, principalName),
    user: rawData,
    model: SONNET_MODEL,
    maxTokens: 1500,
    timeout: 30000,
  });

  if (result.success && result.output) {
    // Append meta line if inference didn't include it
    const output = result.output;
    if (!output.includes("ratings,")) {
      const meta =
        `\n---\n*${data.ratings.count} ratings, ${data.sessionCount} sessions, ` +
        `${data.reflections.length} reflections, ${data.opinions.length} opinions, ` +
        `${data.wisdomFrames.reduce((s, f) => s + f.principles.length, 0)} principles, ` +
        `${data.graduated.length} graduated patterns — ${data.days}-day window*`;
      return output + meta;
    }
    return output;
  }

  // Fallback: return raw data summary if inference fails
  return `# Self-Model — ${aiName}\n*Synthesis failed — raw data below*\n\n${rawData}`;
}

// ── Write ──

export async function writeSelfModel(
  days: number
): Promise<{ path: string; content: string }> {
  const content = await composeSelfModel(days);
  const modelPath = selfModelPath();
  const metaPath = selfModelMetaPath();

  writeFileSync(modelPath, content, "utf-8");
  writeFileSync(
    metaPath,
    JSON.stringify({ timestamp: new Date().toISOString(), days }, null, 2),
    "utf-8"
  );

  return { path: modelPath, content };
}

// ── CLI ──

async function run() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      days: { type: "string", default: "30" },
      force: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
SelfModel — Synthesize a first-person self-model from accumulated data

Usage:
  bun self-model.ts [--days 30] [--force] [--dry-run]

Options:
  --days     Lookback window (default: 30)
  --force    Skip 24h guard
  --dry-run  Print to stdout without writing

Output: ~/.pal/memory/self-model.md (synthesized by Sonnet)
`);
    process.exit(0);
  }

  const force = values.force ?? false;
  const dryRun = values["dry-run"] ?? false;

  if (!shouldRun(force) && !dryRun) {
    console.log(
      JSON.stringify({
        skipped: true,
        message: "Last self-model < 24h ago. Use --force to override.",
      })
    );
    return;
  }

  const days = parseInt(values.days ?? "30", 10);

  if (dryRun) {
    console.log(await composeSelfModel(days));
    return;
  }

  const { path } = await writeSelfModel(days);

  console.log(
    JSON.stringify(
      {
        success: true,
        path,
        days,
        message: `Self-model written (${days}-day window)`,
      },
      null,
      2
    )
  );
}

if (import.meta.main) run();
