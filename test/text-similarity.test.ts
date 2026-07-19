import { describe, expect, test } from "bun:test";
import {
  containment,
  extractKeywords,
  similarity,
} from "../src/hooks/lib/text-similarity";

describe("similarity (Dice coefficient)", () => {
  test("identical strings return 1", () => {
    expect(
      similarity(
        "always verify version before release",
        "always verify version before release"
      )
    ).toBe(1);
  });

  test("completely different strings return 0", () => {
    expect(similarity("deploy production server", "bake chocolate cake")).toBe(0);
  });

  test("similar texts score above threshold", () => {
    const score = similarity(
      "Always verify package version before publishing to npm registry",
      "Verify npm package version matches git tag before release"
    );
    expect(score).toBeGreaterThanOrEqual(0.45);
  });

  test("empty strings return 0", () => {
    expect(similarity("", "")).toBe(0);
    expect(similarity("hello world", "")).toBe(0);
  });

  test("Dice scores higher than Jaccard would for partial overlap", () => {
    // Dice is more generous — "help" vs "help me please" should score well
    const score = similarity(
      "User frustrated by stale installation issue",
      "User frustrated by unexplained stale plugin"
    );
    expect(score).toBeGreaterThanOrEqual(0.4);
  });
});

describe("containment (asymmetric)", () => {
  const statement =
    "Prefers detailed architectural explanations before any refactoring begins, including trade-offs, alternatives considered, and reasoning about long-term maintenance cost";

  test("short keyword query fully contained in a long statement scores 1", () => {
    expect(containment("architectural explanations", statement)).toBe(1);
  });

  test("is not penalized by statement length the way Dice is", () => {
    // Dice caps a 2-keyword query against this 15-keyword statement below 0.3;
    // containment reaches the default lookup threshold.
    expect(similarity("architectural explanations", statement)).toBeLessThan(0.3);
    expect(containment("architectural explanations", statement)).toBeGreaterThanOrEqual(
      0.3
    );
  });

  test("returns 0 when no query keyword is present", () => {
    expect(containment("deploy production server", statement)).toBe(0);
  });

  test("empty inputs return 0", () => {
    expect(containment("", statement)).toBe(0);
    expect(containment("architectural", "")).toBe(0);
  });
});

describe("extractKeywords", () => {
  test("removes stop words", () => {
    const kw = extractKeywords("the quick brown fox is very fast");
    expect(kw.has("the")).toBe(false);
    expect(kw.has("very")).toBe(false);
    expect(kw.has("quick")).toBe(true);
    expect(kw.has("brown")).toBe(true);
  });

  test("filters short words", () => {
    const kw = extractKeywords("I am ok no");
    expect(kw.size).toBe(0);
  });
});
