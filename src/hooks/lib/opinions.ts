/**
 * Opinion store — persistent confidence-tracked opinions about the user.
 *
 * Opinions are promoted from recurring relationship notes (O/B types) by the
 * reflect tool. Confidence evolves with evidence over time.
 * High-confidence opinions (≥85%) are injected into every session context.
 *
 * Storage: memory/relationship/opinions.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";
import { similarity } from "./text-similarity";

// ── Types ──

export type EvidenceType = "supporting" | "counter" | "confirmation" | "contradiction";
export type OpinionCategory = "communication" | "technical" | "workflow" | "general";

export interface Evidence {
  date: string;
  type: EvidenceType;
  source: string;
}

export interface Opinion {
  id: string;
  statement: string;
  confidence: number;
  category: OpinionCategory;
  evidence: Evidence[];
  created: string;
  updated: string;
}

// ── Confidence Deltas (matching original PAI) ──

const CONFIDENCE_DELTAS: Record<EvidenceType, number> = {
  supporting: 0.05,
  counter: -0.1,
  confirmation: 0.1,
  contradiction: -0.2,
};

const MIN_CONFIDENCE = 0.01;
const MAX_CONFIDENCE = 0.99;
const HIGH_CONFIDENCE_THRESHOLD = 0.85;

// ── Category Classification ──

const CATEGORY_MAP: [RegExp, OpinionCategory][] = [
  [/tone|format|response|verbose|brief|concise|explain|direct|style/i, "communication"],
  [/code|test|build|deploy|function|type|lint|debug|refactor/i, "technical"],
  [/commit|git|release|workflow|process|approach|iterative|step/i, "workflow"],
];

function classifyCategory(text: string): OpinionCategory {
  for (const [pattern, category] of CATEGORY_MAP) {
    if (pattern.test(text)) return category;
  }
  return "general";
}

// ── File Path ──

function opinionsPath(): string {
  return resolve(paths.relationship(), "opinions.json");
}

// ── Store Format ──

interface OpinionStore {
  lastReflect: string;
  opinions: Opinion[];
}

// ── CRUD ──

function readStore(): OpinionStore {
  const fp = opinionsPath();
  if (!existsSync(fp)) return { lastReflect: "", opinions: [] };
  try {
    const raw = JSON.parse(readFileSync(fp, "utf-8"));
    // Migrate from plain array format
    if (Array.isArray(raw)) return { lastReflect: "", opinions: raw };
    return raw as OpinionStore;
  } catch {
    return { lastReflect: "", opinions: [] };
  }
}

function writeStore(store: OpinionStore): void {
  writeFileSync(opinionsPath(), JSON.stringify(store, null, 2), "utf-8");
}

export function readOpinions(): Opinion[] {
  return readStore().opinions;
}

export function getLastReflectDate(): string {
  return readStore().lastReflect;
}

export function setLastReflectDate(date: string): void {
  const store = readStore();
  store.lastReflect = date;
  writeStore(store);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");
}

/** Find an existing opinion similar to the given text. Returns the opinion or null. */
export function findSimilarOpinion(
  text: string,
  opinions: Opinion[],
  threshold = 0.3
): Opinion | null {
  for (const op of opinions) {
    if (similarity(text, op.statement) >= threshold) return op;
  }
  return null;
}

/** Create a new opinion from a recurring note. Starts at confidence 0.60. */
export function createOpinion(statement: string, source: string): Opinion {
  const now = new Date().toISOString().slice(0, 10);
  return {
    id: slugify(statement),
    statement,
    confidence: 0.6,
    category: classifyCategory(statement),
    evidence: [{ date: now, type: "supporting", source }],
    created: now,
    updated: now,
  };
}

/** Check if an opinion already has evidence with this exact source text. */
export function hasEvidence(opinion: Opinion, source: string): boolean {
  return opinion.evidence.some((e) => e.source === source);
}

/** Add evidence to an opinion and adjust its confidence. No-op if duplicate. */
export function addEvidence(
  opinion: Opinion,
  type: EvidenceType,
  source: string
): Opinion {
  if (hasEvidence(opinion, source)) return opinion;

  const now = new Date().toISOString().slice(0, 10);
  const delta = CONFIDENCE_DELTAS[type];
  const newConfidence = Math.min(
    MAX_CONFIDENCE,
    Math.max(MIN_CONFIDENCE, opinion.confidence + delta)
  );

  return {
    ...opinion,
    confidence: Math.round(newConfidence * 100) / 100,
    evidence: [...opinion.evidence, { date: now, type, source }],
    updated: now,
  };
}

/** Upsert an opinion into the store. */
export function saveOpinion(opinion: Opinion): void {
  const store = readStore();
  const idx = store.opinions.findIndex((o) => o.id === opinion.id);
  if (idx >= 0) {
    store.opinions[idx] = opinion;
  } else {
    store.opinions.push(opinion);
  }
  writeStore(store);
}

// ── Context Loading ──

/** Load high-confidence opinions formatted for system-reminder injection. */
export function loadOpinionContext(threshold = HIGH_CONFIDENCE_THRESHOLD): string {
  const opinions = readOpinions().filter((o) => o.confidence >= threshold);
  if (opinions.length === 0) return "";

  const lines = opinions.map(
    (o) => `- [${o.category}] ${o.statement} (${Math.round(o.confidence * 100)}%)`
  );
  return ["## Tracked Opinions", ...lines].join("\n");
}
