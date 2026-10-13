import { beforeEach, describe, expect, test } from "bun:test";
import { efficiency } from "../src/tools/lib/cost/efficiency";
import { efficiencyLines } from "../src/tools/lib/cost/render";
import { budapestHome, event } from "./lib/wrapped-events";

beforeEach(() => {
  budapestHome(import.meta.file);
});

const call = (costUsd: number | null, ts: string, tokens: Record<string, number> = {}) =>
  event("model_call", costUsd === null ? tokens : { costUsd, ...tokens }, {
    runtime: costUsd === null ? "copilot" : "opencode",
    ts,
  });

const at = (type: "commit" | "commitment", ts: string, fields = {}) =>
  event(type, fields, { ts });

describe("efficiency", () => {
  test("nothing is known before the first model call", () => {
    expect(efficiency([at("commit", "2026-06-01T10:00:00.000Z")])).toBeNull();
  });

  test("spend is split over the commits and kept ISCs since the first call", () => {
    const result = efficiency([
      at("commit", "2026-06-01T07:59:00.000Z"),
      call(3, "2026-06-01T09:00:00.000Z"),
      call(1, "2026-06-01T08:00:00.000Z"),
      at("commit", "2026-06-01T08:00:00.000Z"),
      at("commit", "2026-06-02T08:00:00.000Z"),
      at("commitment", "2026-06-01T07:00:00.000Z", { outcome: "kept" }),
      at("commitment", "2026-06-01T09:00:00.000Z", { outcome: "kept" }),
      at("commitment", "2026-06-01T09:00:00.000Z", { outcome: "broken" }),
      at("commitment", "2026-06-01T09:00:00.000Z", { outcome: "broken" }),
    ]);
    expect(result).toEqual({
      since: "2026-06-01",
      perCommit: { cost: 2, units: 2, lowerBound: false },
      perClosedIsc: { cost: 4, units: 1, lowerBound: false },
      cacheHitRate: null,
    });
  });

  test("unpriced calls make the cost a lower bound; no units leave it unknown", () => {
    const result = efficiency([
      call(2, "2026-06-01T08:00:00.000Z"),
      call(null, "2026-06-01T08:00:00.000Z"),
      at("commit", "2026-06-01T09:00:00.000Z"),
    ]);
    expect(result?.perCommit).toEqual({ cost: 2, units: 1, lowerBound: true });
    expect(result?.perClosedIsc).toBeNull();
  });

  test("cache hit rate is cache reads over every prompt token", () => {
    const result = efficiency([
      call(1, "2026-06-01T08:00:00.000Z", { inputTokens: 10, cacheRead: 60 }),
      call(1, "2026-06-01T08:00:00.000Z", { cacheWrite5m: 20, cacheWrite1h: 10 }),
    ]);
    expect(result?.cacheHitRate).toBe(0.6);
  });
});

describe("efficiency as printed", () => {
  test("lower bounds say so and unknowns stay unknown", () => {
    expect(efficiencyLines(null)).toEqual([]);
    expect(
      efficiencyLines({
        since: "2026-06-01",
        perCommit: { cost: 2.5, units: 1200, lowerBound: true },
        perClosedIsc: null,
        cacheHitRate: 0.8766,
      })
    ).toEqual([
      "\n  Since 2026-06-01\n",
      "    Per commit       at least $2.50 over 1,200 commits",
      "    Per closed ISC   unknown",
      "    Cache hit rate   87.7%",
    ]);
    expect(
      efficiencyLines({
        since: "2026-06-01",
        perCommit: { cost: 1, units: 3, lowerBound: false },
        perClosedIsc: { cost: 4, units: 1, lowerBound: false },
        cacheHitRate: null,
      }).slice(1)
    ).toEqual([
      "    Per commit       $1.00 over 3 commits",
      "    Per closed ISC   $4.00 over 1 ISC",
      "    Cache hit rate   unknown",
    ]);
  });
});
