/**
 * Retrieval ranker — score the indexed corpus against a fresh prompt and produce a
 * ≤500-char `<system-reminder>` block of the top-N matching principles.
 *
 * Algorithm: IDF-weighted term overlap with capped tf, sqrt length-norm, age decay,
 * cwd-fingerprint scope boost, confidence threshold.
 */

import { basename } from "node:path";
import { anchorMatchesCwd } from "./anchor";
import { readAllProjects } from "./projects";
import type { IndexedDoc, RetrievalIndex } from "./retrieval-index";
import { extractKeywords } from "./text-similarity";

const TF_CAP = 3;
const TIME_HALF_LIFE_DAYS = 90;
const SCOPE_BOOST = 1.5;
const CONFIDENCE_THRESHOLD = 0.18;
const MAX_MATCHES = 2;
const MAX_REMINDER_BYTES = 500;
const PRINCIPLE_TRUNC = 200;

interface ScoredDoc {
  doc: IndexedDoc;
  score: number;
  confidence: number;
  scopeMatch: boolean;
}

function idf(term: string, df: Record<string, number>, N: number): number {
  return Math.log((N + 1) / ((df[term] ?? 0) + 1)) + 1;
}

function ageDecay(ts: string): number {
  if (!ts) return 1;
  const age = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(age) || age <= 0) return 1;
  const days = age / 86_400_000;
  return Math.exp(-days / TIME_HALF_LIFE_DAYS);
}

/** Raw IDF-weighted overlap score, capped tf, sqrt-length-normalized. */
function scoreDoc(
  queryTerms: Set<string>,
  doc: IndexedDoc,
  df: Record<string, number>,
  N: number
): number {
  if (doc.len === 0) return 0;
  let s = 0;
  for (const t of queryTerms) {
    const tf = doc.tf[t];
    if (!tf) continue;
    s += idf(t, df, N) * Math.min(tf, TF_CAP);
  }
  if (s === 0) return 0;
  return s / Math.sqrt(doc.len);
}

/** Upper bound: query treated as a doc with tf=1 per unique term. */
function selfScore(
  queryTerms: Set<string>,
  df: Record<string, number>,
  N: number
): number {
  if (queryTerms.size === 0) return 0;
  let s = 0;
  for (const t of queryTerms) s += idf(t, df, N);
  return s / Math.sqrt(queryTerms.size);
}

/** Does any token of the doc's tf map match the cwd basename (lowercased)? */
function scopeMatches(doc: IndexedDoc, scopeKey: string): boolean {
  if (!scopeKey) return false;
  return doc.tf[scopeKey] !== undefined;
}

/** Rank the index against `query`. Returns docs above the confidence threshold,
 *  scope-boosted and age-decayed, sorted high-to-low, capped at MAX_MATCHES. */
function rank(query: string, index: RetrievalIndex, cwd: string): ScoredDoc[] {
  const queryTerms = extractKeywords(query);
  if (queryTerms.size === 0) return [];

  const N = Math.max(index.corpusSize, 1);
  const self = selfScore(queryTerms, index.df, N);
  if (self === 0) return [];

  const scopeKey = basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const scopeTokens = scopeKey ? extractKeywords(scopeKey) : new Set<string>();
  // Loaded once per rank() call, not per doc — the registry rarely changes
  // within a single retrieval pass.
  const projects = readAllProjects();

  const scored: ScoredDoc[] = [];
  for (const doc of index.docs) {
    const raw = scoreDoc(queryTerms, doc, index.df, N);
    if (raw === 0) continue;
    // Anchored or plain cwd resolved against the local registry when
    // available; fingerprint heuristic for captures with no cwd at all.
    const scopeMatch = doc.cwd
      ? anchorMatchesCwd(doc.cwd, cwd, projects)
      : [...scopeTokens].some((t) => scopeMatches(doc, t));
    const boosted = raw * (scopeMatch ? SCOPE_BOOST : 1) * ageDecay(doc.ts);
    const confidence = boosted / self;
    if (confidence < CONFIDENCE_THRESHOLD) continue;
    scored.push({ doc, score: boosted, confidence, scopeMatch });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_MATCHES);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function formatAgo(ts: string): string {
  if (!ts) return "";
  const age = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(age) || age <= 0) return "";
  const days = Math.floor(age / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatLine(s: ScoredDoc): string {
  const scopeTag = s.scopeMatch ? "[project]" : "[global]";
  const tag = s.doc.source === "wisdom" ? `[${s.doc.displayContext}]` : scopeTag;
  const text = s.doc.displayPrinciple || s.doc.displayContext || "";
  const principle = truncate(text, PRINCIPLE_TRUNC);
  if (s.doc.source === "wisdom") {
    return `- ${tag} ${principle} (CRYSTAL ${s.doc.rating}%)`;
  }
  const ago = formatAgo(s.doc.ts);
  const kind = s.doc.source === "reflection" ? "reflection" : "rating";
  const meta = ago ? `${kind} ${s.doc.rating}/10, ${ago}` : `${kind} ${s.doc.rating}/10`;
  return `- ${tag} ${principle} (${meta})`;
}

/** Build the `<system-reminder>` block. Drops lowest-ranked lines until ≤500 bytes. */
function formatReminder(matches: ScoredDoc[]): string {
  if (matches.length === 0) return "";
  let lines = matches.map(formatLine);

  let block = render(lines);
  while (block.length > MAX_REMINDER_BYTES && lines.length > 1) {
    lines = lines.slice(0, -1);
    block = render(lines);
  }
  if (block.length > MAX_REMINDER_BYTES) return "";
  return block;
}

function render(lines: string[]): string {
  return [
    "<system-reminder>",
    "**Relevant prior lessons** (matched on your prompt):",
    ...lines,
    "</system-reminder>",
  ].join("\n");
}

/** End-to-end retrieval: takes a query + index, returns the formatted reminder string. */
export function runRetrieval(
  query: string,
  index: RetrievalIndex,
  cwd: string
): { reminder: string; matches: ScoredDoc[] } {
  const matches = rank(query, index, cwd);
  return { reminder: formatReminder(matches), matches };
}
