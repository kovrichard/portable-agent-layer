import type { LoggedEvent } from "../../../hooks/lib/events";
import { type CostTotals, costMonths, costTotals } from "../cost-report";
import { numberOf, ofType } from "./year";

export interface WrappedTotals {
  projects: number;
  sessions: number;
  commits: number;
  tokens: number;
  callsWithoutTokens: number;
  cost: CostTotals;
}

const TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheWrite5m",
  "cacheWrite1h",
  "cacheRead",
] as const;

function tokensOf(call: LoggedEvent): number | null {
  const known = TOKEN_FIELDS.map((f) => numberOf(call[f])).filter((n) => n !== null);
  return known.length === 0 ? null : known.reduce((sum, n) => sum + n, 0);
}

function distinct(values: (string | null)[]): number {
  return new Set(values.filter((v) => v !== null)).size;
}

const isSpawnedCall = (e: LoggedEvent) =>
  e.type === "model_call" && e.entrypoint === "sdk-cli";

const showsTheUser = (e: LoggedEvent) =>
  e.type === "turn" || (e.type === "model_call" && !isSpawnedCall(e));

/** PAL's own background inference runs as SDK sessions nobody typed into. */
function sessionsOfTheUser(events: LoggedEvent[]): number {
  const spawned = new Set(events.filter(isSpawnedCall).map((e) => e.session));
  for (const e of events.filter(showsTheUser)) spawned.delete(e.session);
  return distinct(events.map((e) => e.session).filter((s) => !spawned.has(s)));
}

export function wrappedTotals(events: LoggedEvent[]): WrappedTotals {
  const calls = ofType(events, "model_call");
  const tokens = calls.map(tokensOf);
  return {
    projects: distinct(events.map((e) => e.project)),
    sessions: sessionsOfTheUser(events),
    commits: ofType(events, "commit").length,
    tokens: tokens.reduce<number>((sum, n) => sum + (n ?? 0), 0),
    callsWithoutTokens: tokens.filter((n) => n === null).length,
    cost: costTotals(costMonths(calls)),
  };
}
