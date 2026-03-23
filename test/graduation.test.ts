import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-graduation");

beforeAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });

  // Create failure entries (need 3+ similar ones to trigger graduation)
  for (let i = 1; i <= 4; i++) {
    const slug = `20260322-10000${i}_test-failure-${i}`;
    const dir = resolve(TEST_HOME, "memory", "learning", "failures", "2026", "03", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "sentiment.json"),
      JSON.stringify({
        rating: 2,
        context: "semantic-release published wrong version number again",
        ts: `2026-03-${20 + i}T10:00:0${i}.000Z`,
        slug,
      })
    );
  }

  // Create a different pattern (only 2x — should NOT graduate)
  for (let i = 1; i <= 2; i++) {
    const slug = `20260322-20000${i}_other-issue-${i}`;
    const dir = resolve(TEST_HOME, "memory", "learning", "failures", "2026", "03", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "sentiment.json"),
      JSON.stringify({
        rating: 3,
        context: "UI rendering was completely broken on mobile",
        ts: `2026-03-${20 + i}T11:00:0${i}.000Z`,
        slug,
      })
    );
  }

  // Create principle-based failure entries (3x with similar principles)
  for (let i = 1; i <= 3; i++) {
    const slug = `20260322-30000${i}_principle-failure-${i}`;
    const dir = resolve(TEST_HOME, "memory", "learning", "failures", "2026", "03", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "capture.md"),
      [
        "---",
        "rating: 2",
        `context: "npm versioning went wrong in different ways each time"`,
        `date: "2026-03-2${i}"`,
        `ts: "2026-03-2${i}T12:00:0${i}.000Z"`,
        `slug: "${slug}"`,
        `principle: "Always verify package version before publishing to npm registry"`,
        "---",
        "",
        "## What Went Wrong?",
        "Version mismatch.",
      ].join("\n")
    );
  }

  // Create wisdom directories
  mkdirSync(resolve(TEST_HOME, "memory", "wisdom", "frames"), {
    recursive: true,
  });
  mkdirSync(resolve(TEST_HOME, "memory", "wisdom", "state"), {
    recursive: true,
  });

  process.env.PAL_HOME = TEST_HOME;
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

describe("graduation report", () => {
  test("detects patterns with 3+ occurrences", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    const result = graduate();

    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    const semrelPattern = result.candidates.find((c) =>
      c.pattern.toLowerCase().includes("semantic-release")
    );
    expect(semrelPattern).toBeTruthy();
    expect(semrelPattern?.entries.length).toBeGreaterThanOrEqual(3);
  });

  test("does not include patterns with <3 occurrences", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    const result = graduate();

    const uiPattern = result.candidates.find((c) =>
      c.pattern.toLowerCase().includes("ui rendering")
    );
    expect(uiPattern).toBeUndefined();
  });

  test("does not write to wisdom frames", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    graduate();

    // No frame files should be created — report only
    const framesDir = resolve(TEST_HOME, "memory", "wisdom", "frames");
    const frames = existsSync(framesDir)
      ? readdirSync(framesDir).filter((f) => f.endsWith(".md"))
      : [];
    expect(frames).toHaveLength(0);
  });

  test("reports correct confidence for occurrences", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    const result = graduate();

    // 4 occurrences: 60 + (4-3)*10 = 70%
    const candidate = result.graduated.find((g) =>
      g.sources.some((s) => s.includes("test-failure"))
    );
    expect(candidate).toBeTruthy();
    expect(candidate?.confidence).toBe(70);
  });
});

describe("principle-based grouping", () => {
  test("groups entries by similar principles", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    const result = graduate();

    const principleGroup = result.candidates.find((c) =>
      c.entries.some((e) => e.principle.includes("verify package version"))
    );
    expect(principleGroup).toBeTruthy();
    expect(principleGroup?.entries.length).toBeGreaterThanOrEqual(3);
  });
});

describe("similarity (Jaccard)", () => {
  test("identical strings return 1", async () => {
    const { similarity } = await import("../src/hooks/lib/graduation");
    expect(
      similarity(
        "always verify version before release",
        "always verify version before release"
      )
    ).toBe(1);
  });

  test("completely different strings return 0", async () => {
    const { similarity } = await import("../src/hooks/lib/graduation");
    expect(similarity("deploy production server", "bake chocolate cake")).toBe(0);
  });

  test("similar principles match above threshold", async () => {
    const { similarity, SIMILARITY_THRESHOLD } = await import(
      "../src/hooks/lib/graduation"
    );
    const score = similarity(
      "Always verify package version before publishing to npm registry",
      "Verify npm package version matches git tag before release"
    );
    expect(score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  test("related but different wording still matches", async () => {
    const { similarity, SIMILARITY_THRESHOLD } = await import(
      "../src/hooks/lib/graduation"
    );
    const score = similarity(
      "Always create a git tag before the first semantic-release run",
      "Create git tag for initial version before running semantic-release"
    );
    expect(score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  test("unrelated principles do not match", async () => {
    const { similarity, SIMILARITY_THRESHOLD } = await import(
      "../src/hooks/lib/graduation"
    );
    const score = similarity(
      "Always verify package version before publishing",
      "Use clear error messages when validation fails"
    );
    expect(score).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  test("short vague texts can match (filtered by isActionable instead)", async () => {
    const { similarity } = await import("../src/hooks/lib/graduation");
    const score = similarity("this doesn't work", "it still doesn't work");
    // These share keywords after stop word removal — similarity is high
    // Quality filtering happens via isActionable(), not similarity
    expect(score).toBeGreaterThan(0.5);
  });

  test("empty strings return 0", async () => {
    const { similarity } = await import("../src/hooks/lib/graduation");
    expect(similarity("", "")).toBe(0);
    expect(similarity("hello world", "")).toBe(0);
  });
});

describe("shouldRunGraduation", () => {
  test("returns false right after a run", async () => {
    const { shouldRunGraduation } = await import("../src/hooks/lib/graduation");
    // graduate() writes lastRun to state
    expect(shouldRunGraduation()).toBe(false);
  });
});
