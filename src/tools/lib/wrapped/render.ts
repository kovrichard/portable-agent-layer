import { fmtDuration } from "../session-usage";
import { fmtCost } from "../token-report";
import type { Best, WrappedRecords } from "./records";
import type { WrappedTotals } from "./totals";

const count = (n: number) => n.toLocaleString("en-US");

function row(label: string, value: string): string {
  return `    ${label.padEnd(20)} ${value}`;
}

function recordRow(
  label: string,
  record: Best | null,
  format: (value: number) => string
): string {
  const value =
    record === null ? "unknown" : `${format(record.value)}  (${record.label})`;
  return `    ${label.padEnd(36)} ${value}`;
}

const days = (n: number) => `${count(n)} ${n === 1 ? "day" : "days"}`;

export function recordsLines(records: WrappedRecords): string[] {
  return [
    "\n  Records\n",
    recordRow(
      "most projects registered in a day",
      records.projectsRegisteredInADay,
      count
    ),
    recordRow("most commits in a day", records.commitsInADay, count),
    recordRow("longest project", records.longestProject, days),
    recordRow("longest streak", records.longestStreak, days),
    recordRow("longest agent-alone run", records.longestAgentRun, (sec) =>
      fmtDuration(sec * 1000)
    ),
    recordRow("most expensive turn", records.mostExpensiveTurn, fmtCost),
    recordRow(
      "biggest tool burst",
      records.biggestToolBurst,
      (n) => `${count(n)} tool calls`
    ),
  ];
}

function tokensLabel(totals: WrappedTotals): string {
  const unknown = totals.callsWithoutTokens;
  return unknown > 0
    ? `${count(totals.tokens)} + ${count(unknown)} calls without counts`
    : count(totals.tokens);
}

function apiEquivalentLabel({ cost }: WrappedTotals): string {
  const priced = fmtCost(cost.apiEquivalent);
  return cost.unpriced > 0
    ? `${priced} + ${count(cost.unpriced)} unpriced calls`
    : priced;
}

export function totalsLines(totals: WrappedTotals): string[] {
  return [
    "\n  Totals\n",
    row("projects", count(totals.projects)),
    row("sessions", count(totals.sessions)),
    row("commits", count(totals.commits)),
    row("tokens", tokensLabel(totals)),
    row("API-equivalent", apiEquivalentLabel(totals)),
    row("paid", totals.cost.paid === null ? "unknown" : fmtCost(totals.cost.paid)),
  ];
}
