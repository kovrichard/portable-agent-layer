import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
let SANDBOX: string;

function fakeClaudeOnPath(): string {
  const bin = resolve(SANDBOX, "bin");
  mkdirSync(bin, { recursive: true });
  const claude = resolve(bin, "claude");
  writeFileSync(claude, "#!/bin/sh\necho 1.0.0\n");
  chmodSync(claude, 0o755);
  return [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter);
}

function pal(...args: string[]) {
  const { PAL_SKIP_DOCTOR: _skip, ...env } = process.env;
  const result = spawnSync("bun", ["run", CLI, "cli", ...args], {
    env: {
      ...env,
      PATH: fakeClaudeOnPath(),
      PAL_HOME: resolve(SANDBOX, "home"),
      PAL_SKIP_BROWSER_INSTALL: "1",
      PAL_CLAUDE_DIR: resolve(SANDBOX, ".claude"),
      PAL_OPENCODE_DIR: resolve(SANDBOX, ".opencode"),
      PAL_CURSOR_DIR: resolve(SANDBOX, ".cursor"),
      PAL_COPILOT_DIR: resolve(SANDBOX, ".copilot"),
      PAL_CODEX_DIR: resolve(SANDBOX, ".codex"),
      PAL_GEMINI_DIR: resolve(SANDBOX, ".gemini"),
      PAL_AGENTS_DIR: resolve(SANDBOX, ".agents"),
    },
    encoding: "utf-8",
    timeout: 60000,
  });
  return `${result.stdout}${result.stderr}`;
}

let init: string;
let reinstall: string;
let verbose: string;

beforeAll(() => {
  SANDBOX = mkdtempSync(resolve(tmpdir(), "pal-install-report-"));
  init = pal("init", "--claude");
  reinstall = pal("install", "--claude");
  verbose = pal("install", "--claude", "--verbose");
}, 180000);

afterAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("what init and install print", () => {
  test("init reports health after installing, not before", () => {
    expect(init).toContain("checks passed");
    expect(init).not.toContain("hooks are not registered");
  });

  test("install ends with the doctor's report", () => {
    expect(reinstall).toContain("checks passed");
  });

  test("install keeps its step-by-step log for --verbose", () => {
    expect(reinstall).not.toContain("Merged PAL settings");
    expect(verbose).toContain("Merged PAL settings");
  });

  test("the banner names PAL and nothing else", () => {
    expect(init).toMatch(/^PAL \d+\.\d+\.\d+ init\n/);
    expect(reinstall).toMatch(/^PAL \d+\.\d+\.\d+ install\n/);
    expect(init).not.toContain("Non-destructive");
    expect(reinstall).not.toContain("Existing config was preserved");
  });
});
