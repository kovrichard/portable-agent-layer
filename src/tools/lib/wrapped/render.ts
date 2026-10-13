import { labelOfRuntime } from "../../../hooks/lib/agent-registry";
import type { CostTotals } from "../cost-report";
import { fmtDuration } from "../session-usage";
import { fmtCost } from "../token-report";
import type { RuntimeCost, WrappedAgents } from "./agents";
import type { WrappedHabits } from "./habits";
import type { SkillsNeverUsed, WrappedPal } from "./pal";
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

function neverUsedLines(never: SkillsNeverUsed | null): string[] {
  if (never === null) return [row("skills never used", "unknown")];
  const summary = `${count(never.names.length)} of ${count(never.installed)} since ${never.since}`;
  const names = never.names.length > 0 ? [row("", never.names.join(", "))] : [];
  return [row("skills never used", summary), ...names];
}

/** Nothing logs a steering rule being approved yet. */
export function palLines(pal: WrappedPal): string[] {
  const onTime = pal.promisesOnTime;
  return [
    "\n  PAL\n",
    row("skills used", tallyLabel(pal.skillsUsed)),
    ...neverUsedLines(pal.skillsNeverUsed),
    row("rules approved", "unknown"),
    row(
      "promises on time",
      onTime === null ? "unknown" : `${count(onTime)} of ${count(pal.promisesKept)}`
    ),
  ];
}

function tokensLabel(totals: WrappedTotals): string {
  const unknown = totals.callsWithoutTokens;
  return unknown > 0
    ? `${count(totals.tokens)} + ${count(unknown)} calls without counts`
    : count(totals.tokens);
}

function apiEquivalentLabel(cost: CostTotals): string {
  const priced = fmtCost(cost.apiEquivalent);
  return cost.unpriced > 0
    ? `${priced} + ${count(cost.unpriced)} unpriced calls`
    : priced;
}

const paidLabel = (paid: number | null) => (paid === null ? "unknown" : fmtCost(paid));

function runtimeCostLabel({ runtime, calls, cost }: RuntimeCost): string {
  const api = cost.unpriced === calls ? "unknown" : apiEquivalentLabel(cost);
  return `${labelOfRuntime(runtime)}  API-equivalent ${api}, paid ${paidLabel(cost.paid)}`;
}

const labelled = (tallies: Tally[]) =>
  tallies.map((t) => ({ ...t, name: labelOfRuntime(t.name) }));

/** No agent reports which of Cursor's lines a human typed yet. */
export function agentsLines(agents: WrappedAgents): string[] {
  const [first, ...rest] = agents.costs.map(runtimeCostLabel);
  return [
    "\n  Agents\n",
    row("messages by agent", tallyLabel(labelled(agents.messages))),
    row("cost by agent", first ?? "unknown"),
    ...rest.map((label) => row("", label)),
    row("Cursor human vs AI", "unknown"),
  ];
}

export function totalsLines(totals: WrappedTotals): string[] {
  return [
    "\n  Totals\n",
    row("projects", count(totals.projects)),
    row("sessions", count(totals.sessions)),
    row("commits", count(totals.commits)),
    row("tokens", tokensLabel(totals)),
    row("API-equivalent", apiEquivalentLabel(totals.cost)),
    row("paid", paidLabel(totals.cost.paid)),
  ];
}
