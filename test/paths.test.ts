import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const TEST_DIR = resolve(import.meta.dir, "../.test-home-paths");

beforeAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  // Clean up env
  delete process.env.PAL_HOME;
  delete process.env.PAL_PKG;
});

describe("palHome", () => {
  test("PAL_HOME env override takes precedence", async () => {
    process.env.PAL_HOME = TEST_DIR;
    // Re-import to pick up env
    const { palHome } = await import("../src/hooks/lib/paths");
    expect(palHome()).toBe(TEST_DIR);
    delete process.env.PAL_HOME;
  });

  test("falls back to ~/.pal without env", async () => {
    delete process.env.PAL_HOME;
    process.env.PAL_PKG = TEST_DIR;
    const { palHome } = await import("../src/hooks/lib/paths");
    expect(palHome()).toBe(resolve(homedir(), ".pal"));
    delete process.env.PAL_PKG;
  });
});

describe("palPkg", () => {
  test("PAL_PKG env override takes precedence", async () => {
    process.env.PAL_PKG = TEST_DIR;
    const { palPkg } = await import("../src/hooks/lib/paths");
    expect(palPkg()).toBe(TEST_DIR);
    delete process.env.PAL_PKG;
  });

  test("resolves to repo root by default", async () => {
    delete process.env.PAL_PKG;
    const { palPkg } = await import("../src/hooks/lib/paths");
    const pkg = palPkg();
    // Should contain package.json
    expect(existsSync(resolve(pkg, "package.json"))).toBe(true);
  });
});

describe("paths", () => {
  test("user state paths resolve under palHome", async () => {
    process.env.PAL_HOME = TEST_DIR;
    const { paths } = await import("../src/hooks/lib/paths");
    expect(paths.telos()).toBe(resolve(TEST_DIR, "telos"));
    expect(paths.memory()).toBe(resolve(TEST_DIR, "memory"));
    expect(paths.signals()).toBe(resolve(TEST_DIR, "memory", "signals"));
    delete process.env.PAL_HOME;
  });

  test("ensureDir creates directories", async () => {
    process.env.PAL_HOME = TEST_DIR;
    const { paths } = await import("../src/hooks/lib/paths");
    const signalsDir = paths.signals();
    expect(existsSync(signalsDir)).toBe(true);
    delete process.env.PAL_HOME;
  });
});

describe("assets", () => {
  test("asset paths resolve under palPkg", async () => {
    delete process.env.PAL_PKG;
    const { assets, palPkg } = await import("../src/hooks/lib/paths");
    const pkg = palPkg();
    expect(assets.skills()).toBe(resolve(pkg, "assets", "skills"));
    expect(assets.agents()).toBe(resolve(pkg, "assets", "agents"));
    expect(assets.agentsMdTemplate()).toBe(
      resolve(pkg, "assets", "templates", "AGENTS.md.template")
    );
  });

  test("asset directories exist", async () => {
    const { assets } = await import("../src/hooks/lib/paths");
    expect(existsSync(assets.skills())).toBe(true);
    expect(existsSync(assets.agents())).toBe(true);
    expect(existsSync(assets.agentsMdTemplate())).toBe(true);
  });
});

describe("platform", () => {
  test("defaults resolve under homedir", async () => {
    delete process.env.PAL_CLAUDE_DIR;
    delete process.env.PAL_OPENCODE_DIR;
    delete process.env.PAL_AGENTS_DIR;
    const { platform } = await import("../src/hooks/lib/paths");
    const home = homedir();
    expect(platform.claudeDir()).toBe(resolve(home, ".claude"));
    expect(platform.opencodeDir()).toBe(resolve(home, ".config", "opencode"));
    expect(platform.agentsDir()).toBe(resolve(home, ".agents"));
  });

  test("env overrides work", async () => {
    process.env.PAL_CLAUDE_DIR = "/custom/claude";
    process.env.PAL_OPENCODE_DIR = "/custom/opencode";
    process.env.PAL_AGENTS_DIR = "/custom/agents";
    const { platform } = await import("../src/hooks/lib/paths");
    expect(platform.claudeDir()).toBe("/custom/claude");
    expect(platform.opencodeDir()).toBe("/custom/opencode");
    expect(platform.agentsDir()).toBe("/custom/agents");
    delete process.env.PAL_CLAUDE_DIR;
    delete process.env.PAL_OPENCODE_DIR;
    delete process.env.PAL_AGENTS_DIR;
  });
});
