import type { LoggedEvent } from "../../../hooks/lib/events";
import { apiPriceOf } from "../cost-report";
import { dayOf, numberOf, ofType } from "../wrapped/year";

export interface PerUnit {
  cost: number;
  units: number;
  lowerBound: boolean;
}

export interface Efficiency {
  since: string;
  perCommit: PerUnit | null;
  perClosedIsc: PerUnit | null;
  cacheHitRate: number | null;
}

const PROMPT_FIELDS = [
  "inputTokens",
  "cacheRead",
  "cacheWrite5m",
  "cacheWrite1h",
] as const;

function cacheHitRate(calls: LoggedEvent[]): number | null {
  let read = 0;
  let prompt = 0;
  for (const call of calls) {
    for (const field of PROMPT_FIELDS) prompt += numberOf(call[field]) ?? 0;
    read += numberOf(call.cacheRead) ?? 0;
  }
  return prompt === 0 ? null : read / prompt;
}

function perUnit(spent: number, unpriced: number, units: number): PerUnit | null {
  return units === 0 ? null : { cost: spent / units, units, lowerBound: unpriced > 0 };
}

/** Only since the first logged model call: older commits and ISCs cost nothing PAL saw. */
export function efficiency(events: LoggedEvent[]): Efficiency | null {
  const calls = ofType(events, "model_call");
  const [first] = [...calls].sort((a, b) => a.ts.localeCompare(b.ts));
  if (first === undefined) return null;
  const since = (e: LoggedEvent) => e.ts >= first.ts;
  const prices = calls.map(apiPriceOf);
  const spent = prices.reduce<number>((sum, p) => sum + (p ?? 0), 0);
  const unpriced = prices.filter((p) => p === null).length;
  const commits = ofType(events, "commit").filter(since).length;
  const closed = ofType(events, "commitment").filter(
    (e) => since(e) && e.outcome === "kept"
  ).length;
  return {
    since: dayOf(first),
    perCommit: perUnit(spent, unpriced, commits),
    perClosedIsc: perUnit(spent, unpriced, closed),
    cacheHitRate: cacheHitRate(calls),
  };
}
