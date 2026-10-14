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
