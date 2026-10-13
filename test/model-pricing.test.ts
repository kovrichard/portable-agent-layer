import { beforeEach, describe, expect, test } from "bun:test";
import {
  costOfUsage,
  MODEL_PRICING,
  PRICE_HISTORY,
  pricingFor,
} from "../src/hooks/lib/models";

beforeEach(() => {
  delete PRICE_HISTORY["claude-opus-5"];
});

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

  test("Haiku 5.5 carries its published rates for prompts up to 100k tokens", () => {
    expect(MODEL_PRICING["claude-haiku-5-5"]).toEqual({
      input: 0.1,
      output: 0.5,
      cacheWrite5m: 0.125,
      cacheWrite1h: 0.2,
      cacheRead: 0.01,
    });
  });

  test("the point releases carry their own rates, not their base model's", () => {
    expect(pricingFor("claude-opus-5-5")).toEqual({
      input: 4,
      output: 20,
      cacheWrite5m: 5,
      cacheWrite1h: 8,
      cacheRead: 0.2,
    });
    expect(pricingFor("claude-sonnet-5-5")).toEqual({
      input: 2,
      output: 10,
      cacheWrite5m: 2.5,
      cacheWrite1h: 4,
      cacheRead: 0.1,
    });
    expect(pricingFor("claude-fable-5-1")).toEqual({
      input: 10,
      output: 50,
      cacheWrite5m: 12.5,
      cacheWrite1h: 20,
      cacheRead: 0.25,
    });
  });

  test("OpenAI models carry their standard rates, cache writes billed as input", () => {
    expect(pricingFor("gpt-6-luna")).toEqual({
      input: 0.1,
      output: 0.5,
      cacheWrite5m: 0.1,
      cacheWrite1h: 0.1,
      cacheRead: 0.01,
    });
    expect(pricingFor("gpt-6.1-sol")?.cacheRead).toBe(0.1);
    expect(pricingFor("gpt-6-sol")?.cacheRead).toBe(0.2);
    expect(pricingFor("gpt-5.4-mini")?.output).toBe(4.5);
  });

  test("a pro model is not billed at its base model's rates", () => {
    expect(pricingFor("gpt-5.4-pro")).toEqual({
      input: 30,
      output: 180,
      cacheWrite5m: 30,
      cacheWrite1h: 30,
      cacheRead: 30,
    });
  });

  test("Kimi K3 on Fireworks is priced under the ID opencode logs", () => {
    expect(pricingFor("fireworks-ai/accounts/fireworks/models/kimi-k3")).toEqual({
      input: 3,
      output: 15,
      cacheWrite5m: 3,
      cacheWrite1h: 3,
      cacheRead: 0.3,
    });
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
    expect(pricingFor("acme-model-1")).toBeNull();
  });
});

describe("a price change", () => {
  const OPUS_5_LAUNCH = { ...OPUS_5_RATES, input: 6, output: 30 };

  beforeEach(() => {
    PRICE_HISTORY["claude-opus-5"] = [{ until: "2026-09-01", rates: OPUS_5_LAUNCH }];
  });

  test("a call before the change is priced at the rate then in force", () => {
    expect(pricingFor("claude-opus-5", "2026-08-31T23:59:59Z")).toEqual(OPUS_5_LAUNCH);
  });

  test("a call from the change on is priced at the new rate", () => {
    expect(pricingFor("claude-opus-5", "2026-09-01T00:00:00Z")).toEqual(OPUS_5_RATES);
  });

  test("a dated or tagged ID follows its base model's history", () => {
    expect(pricingFor("claude-opus-5-20260115", "2026-08-01T00:00:00Z")).toEqual(
      OPUS_5_LAUNCH
    );
  });

  test("a call with no date is priced at today's rate", () => {
    expect(pricingFor("claude-opus-5")).toEqual(OPUS_5_RATES);
  });

  test("the cost of a usage record follows the date it is given", () => {
    const usage = {
      input: 1_000_000,
      output: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
    };
    expect(costOfUsage("claude-opus-5", usage, "2026-08-15T12:00:00Z")).toBeCloseTo(
      6,
      10
    );
    expect(costOfUsage("claude-opus-5", usage, "2026-09-15T12:00:00Z")).toBeCloseTo(
      5,
      10
    );
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
      costOfUsage("acme-model-1", {
        input: 1_000_000,
        output: 1_000_000,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
      })
    ).toBe(0);
  });
});
