import { describe, expect, test } from "bun:test";
import { costOfUsage, MODEL_PRICING, pricingFor } from "../src/hooks/lib/models";

const OPUS_5_RATES = {
  input: 5,
  output: 25,
  cacheWrite5m: 6.25,
  cacheWrite1h: 10,
  cacheRead: 0.5,
};

describe("model pricing table", () => {
  test("Opus 5 carries the published per-MTok rates", () => {
    expect(MODEL_PRICING["claude-opus-5"]).toEqual(OPUS_5_RATES);
  });

  test("every entry prices all five token categories above zero", () => {
    for (const p of Object.values(MODEL_PRICING)) {
      expect(Object.values(p).every((rate) => rate > 0)).toBe(true);
      expect(Object.keys(p).sort()).toEqual(Object.keys(OPUS_5_RATES).sort());
    }
  });
});

describe("pricingFor", () => {
  test("resolves an exact model ID", () => {
    expect(pricingFor("claude-opus-5")).toEqual(OPUS_5_RATES);
  });

  test("resolves a context-tagged ID to its base entry", () => {
    expect(pricingFor("claude-opus-5[1m]")).toEqual(OPUS_5_RATES);
  });

  test("resolves a dated ID to its base entry", () => {
    expect(pricingFor("claude-opus-5-20260115")).toEqual(OPUS_5_RATES);
  });

  test("prefers the longest matching key over the first one", () => {
    expect(pricingFor("claude-sonnet-4-5-20250929")).toEqual(
      MODEL_PRICING["claude-sonnet-4-5"]
    );
  });

  test("returns null for an unknown vendor model", () => {
    expect(pricingFor("gpt-5.5")).toBeNull();
  });
});

describe("costOfUsage", () => {
  test("bills an Opus 5 session across all five categories", () => {
    const cost = costOfUsage("claude-opus-5", {
      input: 1_000_000,
      output: 1_000_000,
      cacheWrite5m: 1_000_000,
      cacheWrite1h: 1_000_000,
      cacheRead: 1_000_000,
    });
    expect(cost).toBeCloseTo(5 + 25 + 6.25 + 10 + 0.5, 10);
  });

  test("bills a context-tagged Opus 5 session identically to the base ID", () => {
    const usage = {
      input: 50_000,
      output: 15_000,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
    };
    // Worked example from the pricing page: 50k in + 15k out on Opus 5 = $0.625.
    expect(costOfUsage("claude-opus-5", usage)).toBeCloseTo(0.625, 10);
    expect(costOfUsage("claude-opus-5[1m]", usage)).toBeCloseTo(0.625, 10);
  });

  test("bills an unpriced model as zero", () => {
    expect(
      costOfUsage("gpt-5.5", {
        input: 1_000_000,
        output: 1_000_000,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
      })
    ).toBe(0);
  });
});
