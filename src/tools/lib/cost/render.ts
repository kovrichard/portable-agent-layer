import { count, counted } from "../report-rows";
import { fmtCost } from "../token-report";
import type { Efficiency, PerUnit } from "./efficiency";
import type { Entry, Leaderboards } from "./leaderboards";
import type { Share } from "./mix";

function entryLine({ label, cost, unpriced }: Entry): string {
  const extra = unpriced > 0 ? ` + ${count(unpriced)} unpriced calls` : "";
  return `    ${fmtCost(cost).padStart(10)}  ${label}${extra}`;
}

function boardLines(title: string, entries: Entry[]): string[] {
  const lines = entries.length === 0 ? ["    unknown"] : entries.map(entryLine);
  return [`\n  Most expensive ${title}\n`, ...lines];
}

export function leaderboardLines(boards: Leaderboards): string[] {
  return [
    ...boardLines("projects", boards.projects),
    ...boardLines("sessions", boards.sessions),
    ...boardLines("days", boards.days),
    ...boardLines("turns", boards.turns),
  ];
}

function perUnitText(per: PerUnit | null, unit: string): string {
  if (per === null) return "unknown";
  const atLeast = per.lowerBound ? "at least " : "";
  return `${atLeast}${fmtCost(per.cost)} over ${counted(per.units, unit)}`;
}

const percent = (rate: number | null) =>
  rate === null ? "unknown" : `${(rate * 100).toFixed(1)}%`;

export function efficiencyLines(efficiency: Efficiency | null): string[] {
  if (efficiency === null) return [];
  return [
    `\n  Since ${efficiency.since}\n`,
    `    Per commit       ${perUnitText(efficiency.perCommit, "commit")}`,
    `    Per closed ISC   ${perUnitText(efficiency.perClosedIsc, "ISC")}`,
    `    Cache hit rate   ${percent(efficiency.cacheHitRate)}`,
  ];
}

function shareLine({ label, calls, cost, unpriced }: Share): string {
  const price = unpriced === calls ? "unknown" : fmtCost(cost);
  const extra = unpriced > 0 && unpriced < calls ? `, ${count(unpriced)} unpriced` : "";
  return `    ${price.padStart(10)}  ${label}  ${counted(calls, "call")}${extra}`;
}

export function shareLines(title: string, shares: Share[]): string[] {
  const lines = shares.length === 0 ? ["    unknown"] : shares.map(shareLine);
  return [`\n  ${title}\n`, ...lines];
}
