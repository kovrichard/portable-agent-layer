import type { LoggedEvent } from "../../../hooks/lib/events";
import { type CostTotals, costMonths, costTotals } from "../cost-report";
import { ofType, type Tally, tally } from "./year";

export interface RuntimeCost {
  runtime: string;
  calls: number;
  cost: CostTotals;
}

export interface WrappedAgents {
  messages: Tally[];
  costs: RuntimeCost[];
}

const runtimeOf = (e: LoggedEvent) => e.runtime;

function costOf(runtime: string, calls: LoggedEvent[]): RuntimeCost {
  const own = calls.filter((c) => c.runtime === runtime);
  return { runtime, calls: own.length, cost: costTotals(costMonths(own)) };
}

/** Shares are counted on the user's messages: sessions are minutes long on one agent and days long on another. */
export function wrappedAgents(events: LoggedEvent[]): WrappedAgents {
  const calls = ofType(events, "model_call");
  return {
    messages: tally(ofType(events, "turn"), runtimeOf),
    costs: tally(calls, runtimeOf).map(({ name }) => costOf(name, calls)),
  };
}
