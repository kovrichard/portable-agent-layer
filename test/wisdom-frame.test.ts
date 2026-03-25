import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-wisdom");

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

beforeEach(() => {
  // Clean frames dir between tests
  const framesDir = resolve(TEST_HOME, "memory", "wisdom", "frames");
  if (existsSync(framesDir)) rmSync(framesDir, { recursive: true });
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

// Dynamic import to pick up PAL_HOME
async function loadModule() {
  // Clear module cache by using a unique query string
  const mod = await import(`../src/tools/wisdom-frame.ts?t=${Date.now()}`);
  return mod.updateFrame as (
    domain: string,
    observation: string,
    type?: string
  ) => {
    success: boolean;
    domain: string;
    type: string;
    message: string;
    framePath: string;
  };
}

describe("wisdom-frame tool", () => {
  test("creates new frame file for unknown domain", async () => {
    const updateFrame = await loadModule();
    const result = updateFrame("testing", "always mock at boundaries");

    expect(result.success).toBe(true);
    expect(result.domain).toBe("testing");
    expect(existsSync(result.framePath)).toBe(true);

    const content = readFileSync(result.framePath, "utf-8");
    expect(content).toContain("# Frame: Testing");
    expect(content).toContain("**Domain:** testing");
    expect(content).toContain("**Observation Count:** 1");
    expect(content).toContain("always mock at boundaries");
  });

  test("increments observation count on update", async () => {
    const updateFrame = await loadModule();
    updateFrame("workflow", "first observation");
    const result = updateFrame("workflow", "second observation");

    expect(result.success).toBe(true);
    const content = readFileSync(result.framePath, "utf-8");
    expect(content).toContain("**Observation Count:** 2");
  });

  test("adds evolution entry to log", async () => {
    const updateFrame = await loadModule();
    updateFrame("development", "initial");
    updateFrame("development", "tests should run before commit");

    const content = readFileSync(
      resolve(TEST_HOME, "memory", "wisdom", "frames", "development.md"),
      "utf-8"
    );
    expect(content).toContain("tests should run before commit");
    expect(content).toContain("## Evolution Log");
  });

  test("adds contextual-rule to correct section", async () => {
    const updateFrame = await loadModule();
    updateFrame("workflow", "setup");
    updateFrame("workflow", "always rebase before merge", "contextual-rule");

    const content = readFileSync(
      resolve(TEST_HOME, "memory", "wisdom", "frames", "workflow.md"),
      "utf-8"
    );
    expect(content).toContain("## Contextual Rules");
    expect(content).toContain("always rebase before merge");
  });

  test("adds anti-pattern with severity metadata", async () => {
    const updateFrame = await loadModule();
    updateFrame("development", "setup");
    updateFrame("development", "mocking DB hides migration bugs", "anti-pattern");

    const content = readFileSync(
      resolve(TEST_HOME, "memory", "wisdom", "frames", "development.md"),
      "utf-8"
    );
    expect(content).toContain("## Anti-Patterns");
    expect(content).toContain("### mocking DB hides migration bugs");
    expect(content).toContain("**Severity:** Medium");
  });

  test("principle type logs to evolution without adding to Core Principles", async () => {
    const updateFrame = await loadModule();
    updateFrame("communication", "setup");
    updateFrame("communication", "user prefers terse summaries", "principle");

    const content = readFileSync(
      resolve(TEST_HOME, "memory", "wisdom", "frames", "communication.md"),
      "utf-8"
    );
    expect(content).toContain("Principle candidate — user prefers terse summaries");
    // Should NOT appear in Core Principles section
    const coreSection = content.split("## Core Principles")[1]?.split("##")[0] ?? "";
    expect(coreSection).not.toContain("user prefers terse summaries");
  });

  test("creates frame with contextual-rule type on first write", async () => {
    const updateFrame = await loadModule();
    const result = updateFrame(
      "infrastructure",
      "always use relative paths",
      "contextual-rule"
    );

    expect(result.success).toBe(true);
    const content = readFileSync(result.framePath, "utf-8");
    expect(content).toContain("## Contextual Rules");
    expect(content).toContain("always use relative paths");
  });

  test("creates frame with anti-pattern type on first write", async () => {
    const updateFrame = await loadModule();
    const result = updateFrame("deployment", "never force-push to main", "anti-pattern");

    expect(result.success).toBe(true);
    const content = readFileSync(result.framePath, "utf-8");
    expect(content).toContain("### never force-push to main");
  });

  test("multiple observations accumulate in evolution log", async () => {
    const updateFrame = await loadModule();
    updateFrame("workflow", "first insight");
    updateFrame("workflow", "second insight");
    updateFrame("workflow", "third insight");

    const content = readFileSync(
      resolve(TEST_HOME, "memory", "wisdom", "frames", "workflow.md"),
      "utf-8"
    );
    expect(content).toContain("**Observation Count:** 3");
    expect(content).toContain("first insight");
    expect(content).toContain("second insight");
    expect(content).toContain("third insight");
  });

  test("reader picks up manually crystallized principles", async () => {
    const updateFrame = await loadModule();
    updateFrame("testing", "setup frame");

    // Manually add a crystallized principle (simulating what a user would do)
    const framePath = resolve(TEST_HOME, "memory", "wisdom", "frames", "testing.md");
    let content = readFileSync(framePath, "utf-8");
    content = content.replace(
      "*No crystallized principles yet. Observations accumulating.*",
      "- Always verify edge cases in boundary tests [CRYSTAL: 90%]"
    );
    writeFileSync(framePath, content);

    // Now test the reader
    const { readFramePrinciples } = await import(
      `../src/hooks/lib/wisdom.ts?t=${Date.now()}`
    );
    const principles = readFramePrinciples();
    expect(principles).toContainEqual(
      expect.stringContaining("Always verify edge cases in boundary tests")
    );
    expect(principles).toContainEqual(expect.stringContaining("90%"));
  });
});
