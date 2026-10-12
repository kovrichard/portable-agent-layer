/**
 * What a subscription costs per month, keyed by the plan recorded on each
 * model_call. Prices from support.claude.com's Max plan article, checked
 * 2026-10-12; the Max launch date from Bloomberg, 2025-04-09.
 */

interface PlanPrice {
  from: string;
  monthlyUsd: number;
}

export const PLAN_PRICES: Record<string, PlanPrice[]> = {
  default_claude_max_5x: [{ from: "2025-04-09", monthlyUsd: 100 }],
  default_claude_max_20x: [{ from: "2025-04-09", monthlyUsd: 200 }],
};

/** The monthly price in force at `at`, or null when the plan or its price then is unknown. */
export function planPriceFor(plan: string | null, at: string): number | null {
  const when = Date.parse(at);
  const inForce = (PLAN_PRICES[plan ?? ""] ?? []).filter(
    (p) => Date.parse(p.from) <= when
  );
  return inForce.at(-1)?.monthlyUsd ?? null;
}
