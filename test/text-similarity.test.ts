import { describe, expect, test } from "bun:test";
import { extractKeywords, similarity } from "../src/hooks/lib/text-similarity";

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
