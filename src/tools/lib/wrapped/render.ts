import { fmtCost } from "../token-report";
import type { WrappedTotals } from "./totals";

const count = (n: number) => n.toLocaleString("en-US");

function row(label: string, value: string): string {
  return `    ${label.padEnd(20)} ${value}`;
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
