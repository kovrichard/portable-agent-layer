/**
 * How often each kind of correction happens, per 100 labelled turns. An opinion
 * works when the rate of its kind drops after it is approved.
 */

import type { Turn } from "./adaptation-turns";
import { hasCurrentKind } from "./correction-kind";

interface KindRate {
  kind: string;
  count: number;
  per100: number;
  suggestions: string[];
}

export interface KindRates {
  turns: number;
  corrections: number;
  unlabelled: number;
  /** Labelled by an older prompt or kind set; backfill relabels them. */
  stale: number;
  kinds: KindRate[];
}

function confirmedCorrections(turns: Turn[]): Turn[] {
  return turns.filter((turn) => turn.confirmed === true);
}

function per100(count: number, turns: number): number {
  return turns === 0 ? 0 : Math.round((count / turns) * 1000) / 10;
}

function rateOf(kind: string, labelled: Turn[], turns: number): KindRate {
  const ofKind = labelled.filter((turn) => turn.correctionKind?.kind === kind);
  const suggestions = ofKind
    .map((turn) => turn.correctionKind?.suggested ?? "")
    .filter((name) => name !== "");
  return {
    kind,
    count: ofKind.length,
    per100: per100(ofKind.length, turns),
    suggestions,
  };
}

export function kindRates(turns: Turn[]): KindRates {
  const corrections = confirmedCorrections(turns);
  const labelled = corrections.filter((turn) => turn.correctionKind);
  const kinds = [...new Set(labelled.map((turn) => turn.correctionKind?.kind ?? ""))]
    .map((kind) => rateOf(kind, labelled, turns.length))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return {
    turns: turns.length,
    corrections: corrections.length,
    unlabelled: corrections.length - labelled.length,
    stale: labelled.filter((turn) => !hasCurrentKind(turn)).length,
    kinds,
  };
}

const MIN_TURNS_AFTER = 200;
const MIN_CORRECTIONS_BEFORE = 5;
const MAX_WINDOW_MS = 30 * 86_400_000;

interface WindowRate {
  turns: number;
  count: number;
  per100: number;
}

interface Windows {
  before: WindowRate;
  after: WindowRate;
}

export interface OpinionEffect extends Windows {
  kind: string;
  /** The kinds no opinion targets, over the same windows: what changed anyway. */
  control: Windows;
  verdict: "stale-labels" | "too-early" | "too-few" | "lower" | "not-lower";
}

function hasStaleLabels(turns: Turn[]): boolean {
  return confirmedCorrections(turns).some((turn) => !hasCurrentKind(turn));
}

function windowRate(counts: (kind: string) => boolean, turns: Turn[]): WindowRate {
  const count = kindRates(turns)
    .kinds.filter((k) => counts(k.kind))
    .reduce((sum, k) => sum + k.count, 0);
  return { turns: turns.length, count, per100: per100(count, turns.length) };
}

function ratio({ before, after }: Windows): number {
  return before.per100 === 0 ? 1 : after.per100 / before.per100;
}

function effectVerdict(own: Windows, control: Windows): OpinionEffect["verdict"] {
  if (own.after.turns < MIN_TURNS_AFTER) return "too-early";
  if (own.before.count < MIN_CORRECTIONS_BEFORE) return "too-few";
  return ratio(own) < ratio(control) ? "lower" : "not-lower";
}

export function opinionEffect(
  kind: string,
  approvedAt: Date,
  turns: Turn[],
  opinionKinds: string[] = [kind],
  now: Date = new Date()
): OpinionEffect {
  const cut = approvedAt.getTime();
  const span = Math.min(MAX_WINDOW_MS, now.getTime() - cut);
  const at = (turn: Turn) => Date.parse(turn.ts);
  const beforeTurns = turns.filter((t) => at(t) >= cut - span && at(t) < cut);
  const afterTurns = turns.filter((t) => at(t) >= cut && at(t) < cut + span);
  const windows = (counts: (k: string) => boolean): Windows => ({
    before: windowRate(counts, beforeTurns),
    after: windowRate(counts, afterTurns),
  });
  const own = windows((k) => k === kind);
  const control = windows((k) => k !== kind && !opinionKinds.includes(k));
  const verdict = hasStaleLabels([...beforeTurns, ...afterTurns])
    ? "stale-labels"
    : effectVerdict(own, control);
  return { kind, ...own, control, verdict };
}

export function splitRates(
  turns: Turn[],
  at: Date
): { before: KindRates; after: KindRates } {
  const cut = at.getTime();
  return {
    before: kindRates(turns.filter((turn) => Date.parse(turn.ts) < cut)),
    after: kindRates(turns.filter((turn) => Date.parse(turn.ts) >= cut)),
  };
}
