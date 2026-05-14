/**
 * Stop handler: promote graduated patterns into wisdom-frame CRYSTAL lines.
 *
 * Idempotency contract — N invocations in quick succession yield ≤1 promotion
 * per pattern. Three layers:
 *
 *  1. TTL guard — skip if `graduated.json:lastRun` is younger than TTL_MS.
 *     Catches accidental thrashing (Stop firing many times/min).
 *
 *  2. State-dedup — `state.graduated[]` tracks every pattern ever promoted.
 *     A pattern with the same principle text never re-promotes, even after
 *     the TTL window closes.
 *
 *  3. Content-dedup — `promoteCrystal` skips if any existing CRYSTAL line in
 *     the target frame is Dice-similar (≥0.3) to the new principle. Last line
 *     of defense against state corruption / manual edits / near-misses.
 *
 * Past attempt at auto-graduation failed precisely because of duplicate writes;
 * this design is structured around that lesson. See feedback memory:
 * `feedback_graduation_idempotency.md`.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyze } from "../lib/graduation";
import { logDebug, logError } from "../lib/log";
import { ensureDir, paths } from "../lib/paths";
import { promoteCrystal } from "../lib/wisdom";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h — matches synthesize.ts
const CRYSTAL_FLOOR = 85;

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

function statePath(): string {
  return resolve(ensureDir(paths.wisdomState()), "graduated.json");
}

function readState(): GraduationState {
  const p = statePath();
  if (!existsSync(p)) return { lastRun: "", graduated: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as Partial<GraduationState>;
    return {
      lastRun: parsed.lastRun ?? "",
      graduated: Array.isArray(parsed.graduated) ? parsed.graduated : [],
    };
  } catch {
    return { lastRun: "", graduated: [] };
  }
}

function writeState(state: GraduationState): void {
  writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8");
}

function withinTtl(state: GraduationState): boolean {
  if (!state.lastRun) return false;
  const last = new Date(state.lastRun).getTime();
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < TTL_MS;
}

function alreadyPromoted(state: GraduationState, pattern: string): boolean {
  return state.graduated.some((g) => g.pattern === pattern);
}

interface AutoGraduateOptions {
  /** Bypass the 24h TTL guard. State + content dedup still apply. */
  force?: boolean;
}

interface AutoGraduateResult {
  ranAnalysis: boolean;
  candidatesAtFloor: number;
  promoted: number;
  skippedByState: number;
  skippedByContent: number;
}

/**
 * Run auto-graduation. Safe to call as often as you like — see file header.
 *
 * Returns a summary of what happened so callers (handler, tests) can reason
 * about the run without re-reading state.
 */
export async function autoGraduate(
  opts: AutoGraduateOptions = {}
): Promise<AutoGraduateResult> {
  const result: AutoGraduateResult = {
    ranAnalysis: false,
    candidatesAtFloor: 0,
    promoted: 0,
    skippedByState: 0,
    skippedByContent: 0,
  };

  const state = readState();
  if (!opts.force && withinTtl(state)) {
    logDebug("auto-graduate", `skip — within TTL (last ${state.lastRun})`);
    return result;
  }

  let analysis: Awaited<ReturnType<typeof analyze>>;
  try {
    analysis = await analyze();
    result.ranAnalysis = true;
  } catch (err) {
    logError("auto-graduate:analyze", err);
    return result;
  }

  const eligible = analysis.graduated.filter((g) => g.confidence >= CRYSTAL_FLOOR);
  result.candidatesAtFloor = eligible.length;

  for (const g of eligible) {
    if (alreadyPromoted(state, g.pattern)) {
      result.skippedByState++;
      continue;
    }
    const outcome = promoteCrystal(g.domain, g.pattern, g.confidence);
    if (outcome.skipped === "duplicate") {
      // Frame already had a Dice-similar CRYSTAL line — record in state so we
      // don't re-attempt next run.
      result.skippedByContent++;
      state.graduated.push({
        pattern: g.pattern,
        domain: g.domain,
        confidence: g.confidence,
        occurrences: g.occurrences,
        sources: g.sources,
        graduatedAt: new Date().toISOString(),
      });
      continue;
    }
    result.promoted++;
    state.graduated.push({
      pattern: g.pattern,
      domain: g.domain,
      confidence: g.confidence,
      occurrences: g.occurrences,
      sources: g.sources,
      graduatedAt: new Date().toISOString(),
    });
  }

  state.lastRun = new Date().toISOString();
  writeState(state);

  if (result.promoted > 0 || result.skippedByState > 0 || result.skippedByContent > 0) {
    logDebug(
      "auto-graduate",
      `promoted=${result.promoted} skipState=${result.skippedByState} skipContent=${result.skippedByContent} candidates=${result.candidatesAtFloor}`
    );
  }
  return result;
}
