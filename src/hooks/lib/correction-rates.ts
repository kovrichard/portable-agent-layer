/**
 * How often each kind of correction happens, per 100 labelled turns. An opinion
 * works when the rate of its kind drops after it is approved.
 */

import type { Turn } from "./adaptation-turns";

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
    kinds,
  };
}

const MIN_TURNS_AFTER = 200;
const MAX_WINDOW_MS = 30 * 86_400_000;

interface WindowRate {
  turns: number;
  count: number;
  per100: number;
}

export interface OpinionEffect {
  kind: string;
  before: WindowRate;
  after: WindowRate;
  verdict: "too-early" | "lower" | "not-lower";
}

function windowRate(kind: string, turns: Turn[]): WindowRate {
  const rate = kindRates(turns).kinds.find((k) => k.kind === kind);
  return { turns: turns.length, count: rate?.count ?? 0, per100: rate?.per100 ?? 0 };
}

function effectVerdict(before: WindowRate, after: WindowRate): OpinionEffect["verdict"] {
  if (after.turns < MIN_TURNS_AFTER) return "too-early";
  return after.per100 < before.per100 ? "lower" : "not-lower";
}

export function opinionEffect(
  kind: string,
  approvedAt: Date,
  turns: Turn[],
  now: Date = new Date()
): OpinionEffect {
  const cut = approvedAt.getTime();
  const span = Math.min(MAX_WINDOW_MS, now.getTime() - cut);
  const at = (turn: Turn) => Date.parse(turn.ts);
  const before = windowRate(
    kind,
    turns.filter((t) => at(t) >= cut - span && at(t) < cut)
  );
  const after = windowRate(
    kind,
    turns.filter((t) => at(t) >= cut && at(t) < cut + span)
  );
  return { kind, before, after, verdict: effectVerdict(before, after) };
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
