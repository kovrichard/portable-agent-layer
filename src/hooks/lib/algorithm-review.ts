/**
 * Algorithm-review cadence — decides when to nudge the MAINTAINER to run an
 * `/algorithm-update` session (fold accumulated Q2 reflections into ALGORITHM.md).
 *
 * Maintainer-only by construction: the nudge fires solely in a PAL repo checkout,
 * detected by the presence of the repo-only `.agents/skills/algorithm-update`
 * skill. That path never ships to downstream installs — package.json `files`
 * lists only `src/` and `assets/`, so `.agents/` is absent everywhere except a
 * source checkout. Downstream users therefore never see this nudge.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readReflections } from "./learning-store";
import { palPkg, paths } from "./paths";

const NUDGE_MIN_COUNT = 25;
const NUDGE_MIN_DAYS = 7;
const DAY_MS = 86_400_000;

function markFile(): string {
  return resolve(paths.state(), "algorithm-review.json");
}

export function readReviewMark(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(markFile(), "utf-8"));
    return typeof parsed.lastReviewedTs === "string" ? parsed.lastReviewedTs : null;
  } catch {
    return null;
  }
}

export function writeReviewMark(ts: string): void {
  writeFileSync(markFile(), `${JSON.stringify({ lastReviewedTs: ts }, null, 2)}\n`);
}

/** True only in a maintainer repo checkout — the repo-only update skill is present. */
export function isMaintainerEnv(): boolean {
  return existsSync(
    resolve(palPkg(), ".agents", "skills", "algorithm-update", "SKILL.md")
  );
}

/** Count reflections newer than the last review mark (all of them, if never reviewed). */
export function countUnreviewed(mark: string | null = readReviewMark()): number {
  const reflections = readReflections(paths.reflectionsFile());
  if (!mark) return reflections.length;
  const cutoff = new Date(mark).getTime();
  return reflections.filter((r) => r.ts && new Date(r.ts).getTime() > cutoff).length;
}

export interface ReviewNudge {
  count: number;
  sinceDays: number;
  since: string | null;
}

/**
 * Nudge data when BOTH thresholds are met (≥25 new AND ≥7 days) in a maintainer
 * env, else null. `now` is injected for testability.
 */
export function algorithmReviewNudge(now: Date): ReviewNudge | null {
  if (!isMaintainerEnv()) return null;
  const mark = readReviewMark();
  const count = countUnreviewed(mark);
  if (count < NUDGE_MIN_COUNT) return null;
  const sinceDays = mark
    ? Math.floor((now.getTime() - new Date(mark).getTime()) / DAY_MS)
    : Number.POSITIVE_INFINITY;
  if (sinceDays < NUDGE_MIN_DAYS) return null;
  return { count, sinceDays, since: mark };
}

/** Formatted nudge section for the session reminder, or "" when it shouldn't fire. */
export function loadAlgorithmReviewNudge(now: Date = new Date()): string {
  const n = algorithmReviewNudge(now);
  if (!n) return "";
  const since = n.since ? new Date(n.since).toISOString().slice(0, 10) : "the start";
  const age = Number.isFinite(n.sinceDays) ? `, ${n.sinceDays}d` : "";
  return [
    "## Algorithm Review Due",
    `🔧 ${n.count} new algorithm reflections since ${since}${age} — run \`/algorithm-update\` to fold the recurring ones into ALGORITHM.md.`,
  ].join("\n");
}
