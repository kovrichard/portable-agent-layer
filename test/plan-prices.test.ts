import { beforeEach, describe, expect, test } from "bun:test";
import { PLAN_PRICES, planPriceFor } from "../src/tools/lib/plan-prices";

const MAX_5X = "default_claude_max_5x";

beforeEach(() => {
  PLAN_PRICES[MAX_5X] = [{ from: "2025-04-09", monthlyUsd: 100 }];
});

describe("plan prices are dated", () => {
  test("a plan prices at its monthly rate once it exists", () => {
    expect(planPriceFor(MAX_5X, "2026-10-12T10:00:00Z")).toBe(100);
    expect(planPriceFor("default_claude_max_20x", "2026-10-12T10:00:00Z")).toBe(200);
  });

  test("a month after a price change pays the new price, a month before the old", () => {
    PLAN_PRICES[MAX_5X].push({ from: "2026-09-01", monthlyUsd: 120 });
    expect(planPriceFor(MAX_5X, "2026-08-31T23:59:59Z")).toBe(100);
    expect(planPriceFor(MAX_5X, "2026-09-01T00:00:00Z")).toBe(120);
  });

  test("before a plan existed, or for a plan not in the table, the price is unknown, not zero", () => {
    expect(planPriceFor(MAX_5X, "2025-04-08T00:00:00Z")).toBeNull();
    expect(planPriceFor("some_new_plan", "2026-10-12T10:00:00Z")).toBeNull();
    expect(planPriceFor(null, "2026-10-12T10:00:00Z")).toBeNull();
  });
});
