import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { removeOnceReleased } from "./lib/remove-once-released";
import { runSync } from "./lib/run";
import { testHome } from "./lib/test-home";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const TEST_HOME = testHome(import.meta.file);

function pal(...args: string[]) {
  return runSync(["bun", "run", CLI, ...args], {
    env: {
      ...process.env,
      PAL_HOME: TEST_HOME,
      PAL_SKIP_DOCTOR: "1",
      PAL_SKIP_BROWSER_INSTALL: "1",
      // Prevent writing to real agent config dirs
      PAL_CLAUDE_DIR: resolve(TEST_HOME, ".claude"),
      PAL_OPENCODE_DIR: resolve(TEST_HOME, ".opencode"),
      PAL_CURSOR_DIR: resolve(TEST_HOME, ".cursor"),
      PAL_COPILOT_DIR: resolve(TEST_HOME, ".copilot"),
      PAL_CODEX_DIR: resolve(TEST_HOME, ".codex"),
      PAL_GEMINI_DIR: resolve(TEST_HOME, ".gemini"),
      PAL_AGENTS_DIR: resolve(TEST_HOME, ".agents"),
    },
    timeout: 15000,
  });
}

let init: ReturnType<typeof pal>;

// `pal cli init` runs `bun install --frozen-lockfile` + telos scaffolding + doctor
// pre-flight; on Windows this is ~5–6s, occasionally over bun-test's 5s default.
beforeAll(() => {
  removeOnceReleased(TEST_HOME);
  mkdirSync(TEST_HOME, { recursive: true });
  init = pal("cli", "init");
}, 30000);

describe("pal help", () => {
  test("shows help text", () => {
    const result = pal("help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pal cli <command>");
    expect(result.stdout).toMatch(/^ {2}init\s/m);
  });

  test("--help flag works", () => {
    const result = pal("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pal cli <command>");
  });
});

describe("pal cli version", () => {
  const expected = `${JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf-8")).version}\n`;

  test.each(["version", "-v", "--version"])("%s prints the package version", (flag) => {
    const result = pal("cli", flag);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expected);
  });
});

describe("pal cli init", () => {
  test("scaffolds telos and memory directories", () => {
    expect(init.status).toBe(0);

    const telosDir = resolve(TEST_HOME, "telos");
    expect(existsSync(telosDir)).toBe(true);

    // Should have scaffolded telos templates
    const telosFiles = readdirSync(telosDir).filter((f) => f.endsWith(".md"));
    expect(telosFiles.length).toBeGreaterThan(0);
  }, 15000);

  test("creates memory state directory", () => {
    const stateDir = resolve(TEST_HOME, "memory", "state");
    expect(existsSync(stateDir)).toBe(true);
  });
});

describe("pal cli export", () => {
  test("--dry-run lists files", () => {
    const result = pal("cli", "export", "--dry-run");
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("telos/");
  });

  test("exports to zip", () => {
    const exportPath = resolve(TEST_HOME, "test-export.zip");
    const result = pal("cli", "export", exportPath);
    expect(result.status).toBe(0);
    expect(existsSync(exportPath)).toBe(true);
  });
});

describe("pal cli unknown", () => {
  test("unknown command exits with error", () => {
    const result = pal("cli", "banana");
    expect(result.status).toBe(1);
    expect(result.stderr).toStartWith("error: unknown command 'banana'");
    expect(result.stderr).toContain("Usage: pal cli <command>");
  });
});
