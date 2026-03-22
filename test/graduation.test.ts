import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
        context: `semantic-release published wrong version number again`,
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

describe("graduation", () => {
  test("detects patterns with 3+ occurrences", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    const result = graduate(true); // dry run

    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    // The 4x "semantic-release" pattern should be found
    const semrelPattern = result.candidates.find((c) =>
      c.pattern.toLowerCase().includes("semantic-release")
    );
    expect(semrelPattern).toBeTruthy();
    expect(semrelPattern?.entries.length).toBeGreaterThanOrEqual(3);
  });

  test("does not graduate patterns with <3 occurrences", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    const result = graduate(true);

    // The 2x "UI rendering" pattern should NOT be a candidate
    const uiPattern = result.candidates.find((c) =>
      c.pattern.toLowerCase().includes("ui rendering")
    );
    expect(uiPattern).toBeUndefined();
  });

  test("dry run does not write files", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    graduate(true);

    const stateFile = resolve(TEST_HOME, "memory", "wisdom", "state", "graduated.json");
    // State file should not exist after dry run
    expect(existsSync(stateFile)).toBe(false);
  });

  test("graduates patterns into wisdom frames", async () => {
    const { graduate } = await import("../src/hooks/lib/graduation");
    const result = graduate(false); // real run

    expect(result.graduated.length).toBeGreaterThanOrEqual(1);

    // Check that a frame file was created
    const domain = result.graduated[0].domain;
    const framePath = resolve(TEST_HOME, "memory", "wisdom", "frames", `${domain}.md`);
    expect(existsSync(framePath)).toBe(true);

    const content = readFileSync(framePath, "utf-8");
    expect(content).toContain("semantic-release");
  });

  test("writes graduation state", async () => {
    const stateFile = resolve(TEST_HOME, "memory", "wisdom", "state", "graduated.json");
    expect(existsSync(stateFile)).toBe(true);

    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(state.lastRun).toBeTruthy();
    expect(state.graduated.length).toBeGreaterThanOrEqual(1);
    expect(state.graduated[0].confidence).toBeGreaterThanOrEqual(60);
  });

  test("confidence starts at 60% for 3 occurrences", async () => {
    const stateFile = resolve(TEST_HOME, "memory", "wisdom", "state", "graduated.json");
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    // 4 occurrences: 60 + (4-3)*10 = 70%
    const entry = state.graduated.find((g: { pattern: string }) =>
      g.pattern.toLowerCase().includes("semantic-release")
    );
    expect(entry).toBeTruthy();
    expect(entry.confidence).toBe(70);
  });
});

describe("shouldRunGraduation", () => {
  test("returns false right after a run", async () => {
    const { shouldRunGraduation } = await import("../src/hooks/lib/graduation");
    // We just ran graduation above, so it should be false
    expect(shouldRunGraduation()).toBe(false);
  });
});
