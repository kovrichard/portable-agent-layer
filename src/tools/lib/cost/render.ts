import { count } from "../report-rows";
import { fmtCost } from "../token-report";
import type { Entry, Leaderboards } from "./leaderboards";

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
