import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-claude-md");

beforeAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });

  // Scaffold telos with content
  mkdirSync(resolve(TEST_HOME, "telos"), { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory", "state"), { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory", "wisdom", "frames"), {
    recursive: true,
  });

  writeFileSync(
    resolve(TEST_HOME, "telos", "MISSION.md"),
    "# Mission\n\nTest mission content\n"
  );
  writeFileSync(
    resolve(TEST_HOME, "telos", "GOALS.md"),
    "# Goals\n\n## Short-term\n- Ship PAL\n"
  );

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
  test("renders template with TELOS content", async () => {
    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeMd();

    expect(result).toContain("Test mission content");
    expect(result).toContain("Ship PAL");
  });

  test("includes memory paths section", async () => {
    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeMd();

    expect(result).toContain("Wisdom frames");
    expect(result).toContain("Relationship notes");
    expect(result).toContain("Session learnings");
    expect(result).toContain("Failure captures");
    expect(result).toContain("Signals");
  });

  test("paths in output point to PAL_HOME", async () => {
    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeMd();

    expect(result).toContain(TEST_HOME);
  });

  test("skips empty telos files", async () => {
    // Write an empty telos file (just template header)
    writeFileSync(
      resolve(TEST_HOME, "telos", "IDEAS.md"),
      "# Ideas\n\n<!-- Jot down ideas as they come. -->\n"
    );

    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeMd();

    // Should not include the empty ideas template
    expect(result).not.toContain("Jot down ideas as they come");
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
