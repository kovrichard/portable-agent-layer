import { describe, expect, test } from "bun:test";
import type { FailureEntry } from "../src/hooks/lib/learning-store";
import { rankFailures } from "../src/hooks/lib/semi-static";

function fail(cwd: string, ts: string, principle: string): FailureEntry {
  return {
    slug: principle,
    path: "",
    rating: 3,
    context: "",
    principle,
    date: ts.slice(0, 10),
    ts,
    cwd,
  };
}

const PAL = "/Users/x/code/pal";
const FYZZ = "/Users/x/code/fyzz";

describe("rankFailures — relevance over recency", () => {
  test("same-project failures rank above more-recent other-project ones", () => {
    const entries = [
      fail(FYZZ, "2026-05-30T10:00:00Z", "fyzz-newest"),
      fail(FYZZ, "2026-05-29T10:00:00Z", "fyzz-older"),
      fail(PAL, "2026-05-01T10:00:00Z", "pal-old"),
    ];
    const ranked = rankFailures(entries, PAL);
    // the PAL one is the OLDEST but must come first — relevance beats recency
    expect(ranked[0].principle).toBe("pal-old");
  });

  test("within the same project, newer comes first", () => {
    const entries = [
      fail(PAL, "2026-05-01T10:00:00Z", "pal-old"),
      fail(PAL, "2026-05-30T10:00:00Z", "pal-new"),
    ];
    expect(rankFailures(entries, PAL).map((e) => e.principle)).toEqual([
      "pal-new",
      "pal-old",
    ]);
  });

  test("other-project failures still fill remaining slots (recency-ordered)", () => {
    const entries = [
      fail(PAL, "2026-05-20T10:00:00Z", "pal-1"),
      fail(FYZZ, "2026-05-31T10:00:00Z", "fyzz-new"),
      fail(FYZZ, "2026-05-10T10:00:00Z", "fyzz-old"),
    ];
    const ranked = rankFailures(entries, PAL);
    expect(ranked[0].principle).toBe("pal-1"); // project first
    expect(ranked.slice(1).map((e) => e.principle)).toEqual(["fyzz-new", "fyzz-old"]);
  });

  test("respects the limit", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      fail(PAL, `2026-05-${10 + i}T10:00:00Z`, `p${i}`)
    );
    expect(rankFailures(entries, PAL, 5)).toHaveLength(5);
  });
});
