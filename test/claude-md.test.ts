import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-claude-md");

beforeAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });

  mkdirSync(resolve(TEST_HOME, "memory", "state"), { recursive: true });

  // Mark setup as complete so buildSetupPrompt returns null
  writeFileSync(
    resolve(TEST_HOME, "memory", "state", "setup.json"),
    JSON.stringify({
      version: 1,
      completed: true,
      steps: {},
    })
  );

  process.env.PAL_HOME = TEST_HOME;
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

describe("buildClaudeMd", () => {
  test("renders template with context routing", async () => {
    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeMd();

    expect(result).toContain("Context Routing");
    expect(result).toContain("CONTEXT_ROUTING.md");
  });

  test("omits setup prompt when setup is complete", async () => {
    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeMd();

    expect(result).not.toContain("SETUP_PROMPT");
  });
});

describe("needsRebuild", () => {
  test("returns true when no AGENTS.md exists", async () => {
    process.env.PAL_CLAUDE_DIR = resolve(TEST_HOME, ".claude");
    process.env.PAL_OPENCODE_DIR = resolve(TEST_HOME, ".opencode");
    mkdirSync(resolve(TEST_HOME, ".claude"), { recursive: true });
    mkdirSync(resolve(TEST_HOME, ".opencode"), { recursive: true });

    const { needsRebuild } = await import("../src/hooks/lib/claude-md");
    expect(needsRebuild()).toBe(true);

    delete process.env.PAL_CLAUDE_DIR;
    delete process.env.PAL_OPENCODE_DIR;
  });
});
