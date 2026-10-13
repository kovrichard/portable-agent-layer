import type { LoggedEvent } from "../../../hooks/lib/events";
import { apiPriceOf } from "../cost-report";
import { numberOf, ofType } from "../wrapped/year";

export interface Share {
  label: string;
  calls: number;
  cost: number;
  unpriced: number;
}

function shares(
  calls: LoggedEvent[],
  labelOf: (call: LoggedEvent) => string,
  priceOf: (call: LoggedEvent) => number | null
): Share[] {
  const byLabel = new Map<string, Share>();
  for (const call of calls) {
    const label = labelOf(call);
    const share = byLabel.get(label) ?? { label, calls: 0, cost: 0, unpriced: 0 };
    byLabel.set(label, share);
    share.calls++;
    const price = priceOf(call);
    if (price === null) share.unpriced++;
    else share.cost += price;
  }
  return [...byLabel.values()].sort(
    (a, b) => b.cost - a.cost || b.calls - a.calls || a.label.localeCompare(b.label)
  );
}

const textOr = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;

export function modelMix(events: LoggedEvent[]): Share[] {
  return shares(
    ofType(events, "model_call"),
    (call) => textOr(call.model, "unknown model"),
    apiPriceOf
  );
}

/** Already inside the model calls PAL spawned; never add it to a total. */
export function palSpend(events: LoggedEvent[]): Share[] {
  return shares(
    ofType(events, "inference_call"),
    (call) => textOr(call.caller, "unknown caller"),
    (call) => numberOf(call.costUsd)
  );
}
