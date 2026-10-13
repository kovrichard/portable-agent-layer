import { fmtDuration } from "../session-usage";
import { fmtCost } from "../token-report";
import type { WrappedHabits } from "./habits";
import type { Best, WrappedRecords } from "./records";
import type { WrappedTotals } from "./totals";
import type { Tally } from "./year";

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

const percent = (share: number | null) =>
  share === null ? "unknown" : `${Math.round(share * 100)}%`;

function tallyLabel(tallies: Tally[]): string {
  if (tallies.length === 0) return "unknown";
  return tallies.map((t) => `${t.name} ${count(t.count)}`).join(" · ");
}

export function habitsLines(habits: WrappedHabits): string[] {
  const hour = habits.mostActiveHour;
  return [
    "\n  Habits\n",
    row(
      "most active hour",
      hour === null ? "unknown" : `${hour.label}  (active on ${days(hour.value)})`
    ),
    row("at night (22-06)", percent(habits.nightShare)),
    row("on weekends", percent(habits.weekendShare)),
    row("messages by channel", tallyLabel(habits.channels)),
    row("skimmed replies", percent(habits.skimRate)),
    row("corrections", percent(habits.correctionRate)),
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
