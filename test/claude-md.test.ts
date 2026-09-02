import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-claude-md");

beforeAll(async () => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });

  mkdirSync(resolve(TEST_HOME, "memory", "state"), { recursive: true });

  writeFileSync(
    resolve(TEST_HOME, "memory", "pal-settings.json"),
    JSON.stringify({
      identity: {
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
  const { reload } = await import("../src/hooks/lib/settings");
  reload();
});

afterAll(async () => {
  delete process.env.PAL_HOME;
  const { reload } = await import("../src/hooks/lib/settings");
  reload();
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

describe("buildClaudeMd", () => {
  test("resolves identity variables from pal-settings.json", async () => {
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

    // Context routing is now inlined in AGENTS.md.template (no separate file).
    expect(result).toContain("Context Routing");
    expect(result).toContain("~/.pal/docs/ALGORITHM.md");
    expect(result).toContain("~/.pal/telos/GOALS.md");
  });

  test("omits setup prompt when setup is complete", async () => {
    const { buildClaudeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeMd();

    expect(result).not.toContain("SETUP_PROMPT");
  });
});

describe("buildClaudeCodeMd", () => {
  test("includes template content", async () => {
    const { buildClaudeCodeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeCodeMd();
    expect(result).toContain("You are TestBot");
    expect(result).toContain("MINIMAL");
  });

  test("prepends @import for self-model when file exists", async () => {
    const selfModelDir = resolve(TEST_HOME, "memory", "self-model");
    mkdirSync(selfModelDir, { recursive: true });
    writeFileSync(resolve(selfModelDir, "current.md"), "# Self Model\ntest content");

    const { buildClaudeCodeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeCodeMd();
    expect(result).toMatch(/^@.*self-model.*current\.md/);

    rmSync(selfModelDir, { recursive: true });
  });

  test("omits @import when self-model does not exist", async () => {
    const { buildClaudeCodeMd } = await import("../src/hooks/lib/claude-md");
    const result = buildClaudeCodeMd();
    expect(result).not.toContain("@");
  });
});

describe("needsRebuild", () => {
  test("returns true when no AGENTS.md exists", async () => {
    // Dirs of its own: the sibling symlink-repair test calls regenerateIfNeeded(),
    // which writes an AGENTS.md into the shared .claude/.opencode pair.
    process.env.PAL_CLAUDE_DIR = resolve(TEST_HOME, ".claude-empty");
    process.env.PAL_OPENCODE_DIR = resolve(TEST_HOME, ".opencode-empty");
    mkdirSync(resolve(TEST_HOME, ".claude-empty"), { recursive: true });
    mkdirSync(resolve(TEST_HOME, ".opencode-empty"), { recursive: true });

    const { needsRebuild } = await import("../src/hooks/lib/claude-md");
    expect(needsRebuild()).toBe(true);

    delete process.env.PAL_CLAUDE_DIR;
    delete process.env.PAL_OPENCODE_DIR;
  });

  test("repairs stale Codex AGENTS.md symlink target", async () => {
    if (process.platform === "win32") return;

    process.env.PAL_CLAUDE_DIR = resolve(TEST_HOME, ".claude");
    process.env.PAL_OPENCODE_DIR = resolve(TEST_HOME, ".opencode");
    process.env.PAL_CODEX_DIR = resolve(TEST_HOME, ".codex");

    const staleDir = resolve(TEST_HOME, ".stale-opencode");
    const codexDir = resolve(TEST_HOME, ".codex");
    const expectedTarget = resolve(TEST_HOME, ".opencode", "AGENTS.md");
    const staleTarget = resolve(staleDir, "AGENTS.md");
    const codexAgents = resolve(codexDir, "AGENTS.md");

    mkdirSync(staleDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(staleTarget, "# stale\n", "utf-8");
    symlinkSync(staleTarget, codexAgents);

    const { regenerateIfNeeded } = await import("../src/hooks/lib/claude-md");
    regenerateIfNeeded();

    expect(resolve(codexDir, readlinkSync(codexAgents))).toBe(expectedTarget);

    delete process.env.PAL_CLAUDE_DIR;
    delete process.env.PAL_OPENCODE_DIR;
    delete process.env.PAL_CODEX_DIR;
  });
});
