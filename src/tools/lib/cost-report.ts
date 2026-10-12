/**
 * What each month cost against what the same calls would have cost at API
 * prices, read off the model_call events. A call is priced exactly as
 * pal cli usage prices it, so the two never disagree about the same data.
 */

import type { LoggedEvent } from "../../hooks/lib/events";
import { costOfUsage } from "../../hooks/lib/models";
import { planPriceFor } from "./plan-prices";
import { fmtCost } from "./token-report";

export interface AgentMonth {
  calls: number;
  unpriced: number;
  apiEquivalent: number;
  billing: Set<string>;
  plans: Map<string, string>;
  apiBilled: number;
  extraUsage: boolean;
}

export type CostMonths = Map<string, Map<string, AgentMonth>>;

const numberOf = (value: unknown) => (typeof value === "number" ? value : 0);

/** Claude Code at its dated rates, opencode at the cost it recorded, anything else unknown. */
function apiPriceOf(event: LoggedEvent): number | null {
  if (event.runtime === "opencode")
    return typeof event.costUsd === "number" ? event.costUsd : null;
  if (event.runtime !== "claude" || typeof event.model !== "string") return null;
  return costOfUsage(
    event.model,
    {
      input: numberOf(event.inputTokens),
      output: numberOf(event.outputTokens),
      cacheWrite5m: numberOf(event.cacheWrite5m),
      cacheWrite1h: numberOf(event.cacheWrite1h),
      cacheRead: numberOf(event.cacheRead),
    },
    event.ts
  );
}

function emptyAgentMonth(): AgentMonth {
  return {
    calls: 0,
    unpriced: 0,
    apiEquivalent: 0,
    billing: new Set(),
    plans: new Map(),
    apiBilled: 0,
    extraUsage: false,
  };
}

function addCall(month: AgentMonth, event: LoggedEvent): void {
  const price = apiPriceOf(event);
  const billing = typeof event.billing === "string" ? event.billing : "unknown";
  month.calls++;
  month.billing.add(billing);
  if (price === null) month.unpriced++;
  else month.apiEquivalent += price;
  if (billing === "api") month.apiBilled += price ?? 0;
  if (billing === "subscription" && typeof event.plan === "string")
    month.plans.set(event.plan, month.plans.get(event.plan) ?? event.ts);
  if (event.extraUsage === true) month.extraUsage = true;
}

export function costMonths(events: LoggedEvent[]): CostMonths {
  const months: CostMonths = new Map();
  for (const event of events) {
    const month = event.ts.slice(0, 7);
    const agents = months.get(month) ?? new Map<string, AgentMonth>();
    months.set(month, agents);
    const agent = agents.get(event.runtime) ?? emptyAgentMonth();
    agents.set(event.runtime, agent);
    addCall(agent, event);
  }
  return months;
}

/** Null when any part of what was paid is unknown. */
function paidFor(month: AgentMonth): number | null {
  if (month.billing.has("unknown")) return null;
  let paid = month.billing.has("api") ? month.apiBilled : 0;
  if (!month.billing.has("subscription")) return paid;
  if (month.plans.size === 0) return null;
  for (const [plan, since] of month.plans) {
    const price = planPriceFor(plan, since);
    if (price === null) return null;
    paid += price;
  }
  return paid;
}

/** Null unless both sides are known and something was paid. */
function leverageOf(month: AgentMonth): number | null {
  const paid = paidFor(month);
  if (paid === null || paid === 0 || month.unpriced > 0) return null;
  return month.apiEquivalent / paid;
}

function apiEquivalentLabel(month: AgentMonth): string {
  if (month.unpriced === month.calls) return "unknown";
  const priced = fmtCost(month.apiEquivalent);
  return month.unpriced > 0 ? `${priced} + ${month.unpriced} unpriced calls` : priced;
}

function paidLabel(month: AgentMonth): string {
  const paid = paidFor(month);
  if (paid === null) return "unknown";
  const extra = month.extraUsage ? " + extra usage (unknown)" : "";
  return `${fmtCost(paid)}${extra}`;
}

function agentLine(label: string, month: AgentMonth): string {
  const leverage = leverageOf(month);
  const bound = month.extraUsage ? "up to " : "";
  const leverageText =
    leverage === null ? "" : `   leverage ${bound}${leverage.toFixed(1)}x`;
  return `    ${label.padEnd(16)} paid ${paidLabel(month)}   API-equivalent ${apiEquivalentLabel(month)}${leverageText}`;
}

export function costLines(months: CostMonths, labelOf: (runtime: string) => string) {
  if (months.size === 0) return ["\n  No model calls in the event log yet\n"];
  return [...months.keys()]
    .sort()
    .flatMap((month) => [
      `\n  ${month}\n`,
      ...[...(months.get(month) ?? [])]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([runtime, agent]) => agentLine(labelOf(runtime), agent)),
    ]);
}
