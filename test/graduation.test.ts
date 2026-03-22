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

  // Create tagged failure entries (3x with shared "versioning" tag)
  for (let i = 1; i <= 3; i++) {
    const slug = `20260322-30000${i}_tagged-failure-${i}`;
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
        'tags: ["versioning", "deployment"]',
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

describe("tag-based grouping", () => {
  test("groups entries by shared tags", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    const result = graduate();

    const versioningGroup = result.candidates.find((c) =>
      c.entries.some((e) => e.tags.includes("versioning"))
    );
    expect(versioningGroup).toBeTruthy();
    expect(versioningGroup?.entries.length).toBeGreaterThanOrEqual(3);
  });
});

describe("shouldRunGraduation", () => {
  test("returns false right after a run", async () => {
    const { shouldRunGraduation } = await import("../src/hooks/lib/graduation");
    // graduate() writes lastRun to state
    expect(shouldRunGraduation()).toBe(false);
  });
});
