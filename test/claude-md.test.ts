import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-claude-md");

beforeAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });

  mkdirSync(resolve(TEST_HOME, "memory", "state"), { recursive: true });

  writeFileSync(
    resolve(TEST_HOME, "memory", "identity.json"),
    JSON.stringify({
      ai: {
        name: "TestBot",
        fullName: "Test Bot System",
        displayName: "TESTBOT",
        catchphrase: "{name} here, ready to test.",
      },
      principal: {
        name: "TestUser",
        timezone: "UTC",
      },
    })
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
  test("resolves identity variables from identity.json", async () => {
    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeMd();

    expect(result).toContain("You are TestBot");
    expect(result).toContain("TESTBOT");
    expect(result).toContain("TestBot here, ready to test.");
  });

  test("includes mode definitions", async () => {
    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeMd();

    expect(result).toContain("MINIMAL");
    expect(result).toContain("NATIVE");
  });

  test("includes context routing", async () => {
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

describe("loadIdentity", () => {
  test("parses AI and principal identity from JSON", async () => {
    const { loadIdentity } = await import("../src/hooks/lib/claude-md");
    const id = loadIdentity();

    expect(id.ai.name).toBe("TestBot");
    expect(id.ai.displayName).toBe("TESTBOT");
    expect(id.ai.catchphrase).toBe("TestBot here, ready to test.");
    expect(id.principal.name).toBe("TestUser");
  });

  test("returns defaults when identity.json is missing", async () => {
    const origHome = process.env.PAL_HOME;
    process.env.PAL_HOME = "/nonexistent";

    const { loadIdentity } = await import("../src/hooks/lib/claude-md");
    const id = loadIdentity();

    expect(id.ai.name).toBe("Assistant");
    expect(id.ai.displayName).toBe("ASSISTANT");
    expect(id.principal.name).toBe("");

    process.env.PAL_HOME = origHome;
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
