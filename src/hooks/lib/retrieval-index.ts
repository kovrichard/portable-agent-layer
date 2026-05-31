/**
 * Retrieval index — single JSON file with per-doc term-frequency vectors and a global
 * document-frequency table over the failures + wisdom-frames + reflections corpus.
 *
 * Built once on first read, rebuilt in the background when source dirs change.
 * Read by the UserPromptSubmit retrieval handler; written by ensureIndex (sync bootstrap)
 * or by a detached `bun src/hooks/lib/retrieval-index.ts --rebuild` invocation.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SIMILARITY_THRESHOLD } from "./graduation";
import { readFailures, readReflections } from "./learning-store";
import { logDebug, logError } from "./log";
import { palPkg, paths } from "./paths";
import { similarity, tokenize } from "./text-similarity";
import { readFramesForRetrieval } from "./wisdom";

// v2: added "reflection" source — bump invalidates v1 caches so they rebuild with it.
const INDEX_VERSION = 2;

export interface IndexedDoc {
  id: string;
  source: "failure" | "wisdom" | "reflection";
  path: string;
  rating: number;
  ts: string;
  tf: Record<string, number>;
  len: number;
  displayPrinciple: string;
  displayContext: string;
  cwd?: string;
}

export interface RetrievalIndex {
  version: number;
  builtAt: string;
  corpusSize: number;
  df: Record<string, number>;
  docs: IndexedDoc[];
}

const CONVERSATION_BLOCK_RE = /## Conversation Summary[\s\S]*?(?=\n## |\n# |$)/g;

/** Read first 800 chars of body excluding the Conversation Summary block. */
function failureBodyExcerpt(content: string): string {
  const stripped = content.replace(CONVERSATION_BLOCK_RE, "");
  const bodyStart = stripped.indexOf("\n---\n");
  const body = bodyStart >= 0 ? stripped.slice(bodyStart + 5) : stripped;
  return body.slice(0, 800);
}

function buildTermFreq(tokens: string[]): { tf: Record<string, number>; len: number } {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  return { tf, len: tokens.length };
}

/** Concatenate weighted fields, tokenize, count tf. Weights produce N-fold token repetition. */
function buildDocTokens(parts: { text: string; weight: number }[]): string[] {
  const all: string[] = [];
  for (const { text, weight } of parts) {
    if (!text) continue;
    const toks = tokenize(text);
    for (let i = 0; i < weight; i++) all.push(...toks);
  }
  return all;
}

export function buildIndex(): RetrievalIndex {
  const docs: IndexedDoc[] = [];
  const df: Record<string, number> = {};

  const frames = readFramesForRetrieval();
  const framePrinciples = frames.map((fr) => fr.principle).filter(Boolean);

  // Failures — skip captures whose principle has already graduated into a frame.
  // Reuses graduation.ts's threshold so the same Dice-similarity rule that promotes
  // patterns to wisdom is the one that hides their source captures from retrieval.
  const allFailures = readFailures(paths.failures());
  const failures = allFailures.filter((f) => {
    if (!f.principle) return true;
    return !framePrinciples.some(
      (fp) => similarity(f.principle, fp) >= SIMILARITY_THRESHOLD
    );
  });
  const skipped = allFailures.length - failures.length;
  if (skipped > 0)
    logDebug(
      "retrieval-index",
      `dedup: skipped ${skipped} captures already represented by graduated frames`
    );

  for (const f of failures) {
    let raw = "";
    try {
      raw = readFileSync(f.path, "utf-8");
    } catch {
      continue;
    }
    const body = failureBodyExcerpt(raw);
    const tokens = buildDocTokens([
      { text: f.principle, weight: 3 },
      { text: f.context, weight: 2 },
      { text: body, weight: 1 },
    ]);
    if (tokens.length === 0) continue;
    const { tf, len } = buildTermFreq(tokens);
    for (const term of Object.keys(tf)) df[term] = (df[term] ?? 0) + 1;
    docs.push({
      id: f.slug,
      source: "failure",
      path: f.path,
      rating: f.rating,
      ts: f.ts,
      tf,
      len,
      displayPrinciple: f.principle,
      displayContext: f.context,
      cwd: f.cwd || undefined,
    });
  }

  // Wisdom frames (each principle = pseudo-doc)
  for (const fr of frames) {
    const tokens = buildDocTokens([
      { text: fr.principle, weight: 3 },
      { text: fr.domain, weight: 2 },
      { text: fr.body, weight: 1 },
    ]);
    if (tokens.length === 0) continue;
    const { tf, len } = buildTermFreq(tokens);
    for (const term of Object.keys(tf)) df[term] = (df[term] ?? 0) + 1;
    docs.push({
      id: `${fr.domain}:${fr.principle.slice(0, 40)}`,
      source: "wisdom",
      path: resolve(paths.wisdom(), `${fr.domain}.md`),
      rating: fr.confidence,
      ts: "",
      tf,
      len,
      displayPrinciple: fr.principle,
      displayContext: fr.domain,
    });
  }

  // Reflections — each Algorithm run's self-observations. q1 ("what I'd do
  // differently") is the actionable lesson; q2/q3 add process and reasoning signal.
  for (const r of readReflections(paths.reflectionsFile())) {
    const tokens = buildDocTokens([
      { text: r.q1, weight: 3 },
      { text: r.task, weight: 2 },
      { text: r.q2, weight: 2 },
      { text: r.q3, weight: 1 },
    ]);
    if (tokens.length === 0) continue;
    const { tf, len } = buildTermFreq(tokens);
    for (const term of Object.keys(tf)) df[term] = (df[term] ?? 0) + 1;
    docs.push({
      id: `reflect:${r.ts}`,
      source: "reflection",
      path: paths.reflectionsFile(),
      rating: r.sentiment,
      ts: r.ts,
      tf,
      len,
      displayPrinciple: r.q1,
      displayContext: r.task,
      cwd: r.cwd || undefined,
    });
  }

  return {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    corpusSize: docs.length,
    df,
    docs,
  };
}

function writeIndex(index: RetrievalIndex): void {
  writeFileSync(paths.retrievalIndex(), JSON.stringify(index));
}

export function readIndex(): RetrievalIndex | null {
  const p = paths.retrievalIndex();
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as RetrievalIndex;
    if (parsed?.version !== INDEX_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True if any source directory was modified after the index was built. */
export function isStale(index: RetrievalIndex): boolean {
  try {
    const builtMs = new Date(index.builtAt).getTime();
    for (const dir of [paths.failures(), paths.wisdom(), paths.reflections()]) {
      if (!existsSync(dir)) continue;
      if (statSync(dir).mtimeMs > builtMs) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Detached background rebuild — fire and forget, never throws. */
function spawnBackgroundRebuild(): void {
  try {
    const script = resolve(palPkg(), "src", "hooks", "lib", "retrieval-index.ts");
    const child = spawn("bun", ["run", script, "--rebuild"], {
      detached: true,
      stdio: "ignore",
      env: process.env,
      windowsHide: true,
    });
    child.unref();
  } catch (err) {
    logError("retrieval-index:spawn", err);
  }
}

/** Return the freshest usable index. Builds synchronously on first run; otherwise
 *  returns the cached index and triggers a background rebuild if the corpus moved. */
export function ensureIndex(): RetrievalIndex {
  const existing = readIndex();
  if (!existing) {
    logDebug("retrieval-index", "no index — building synchronously");
    const fresh = buildIndex();
    writeIndex(fresh);
    return fresh;
  }
  if (isStale(existing)) {
    logDebug("retrieval-index", "stale index — using cached, rebuilding in background");
    spawnBackgroundRebuild();
  }
  return existing;
}

// CLI entry — `bun run src/hooks/lib/retrieval-index.ts --rebuild`
if (import.meta.main) {
  const fresh = buildIndex();
  writeIndex(fresh);
  console.log(
    `built retrieval index — ${fresh.corpusSize} docs, ${Object.keys(fresh.df).length} terms`
  );
}
