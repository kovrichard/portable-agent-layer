import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const LOAD_CONTEXT = resolve(import.meta.dir, "../src/hooks/LoadContext.ts");

let sandbox = "";
let copilotDir = "";
let result: { status: number | null; stdout: string; stderr: string };

/**
 * Every agent directory is redirected, not just Copilot's. LoadContext rebuilds
 * CLAUDE.md wherever claudeDir resolves to, and that falls back to the real
 * ~/.claude — so leaving one unset rewrites the developer's own identity file
 * with the sandbox's empty settings.
 */
function runLoadContext() {
  return spawnSync("bun", ["run", LOAD_CONTEXT, "--agent=copilot"], {
    env: {
      ...process.env,
      PAL_HOME: resolve(sandbox, "home"),
      PAL_COPILOT_DIR: copilotDir,
      PAL_CLAUDE_DIR: resolve(sandbox, "claude"),
      PAL_OPENCODE_DIR: resolve(sandbox, "opencode"),
      PAL_CODEX_DIR: resolve(sandbox, "codex"),
      PAL_CURSOR_DIR: resolve(sandbox, "cursor"),
    },
    input: "",
    encoding: "utf-8",
    timeout: 60000,
  });
}

beforeAll(() => {
  sandbox = mkdtempSync(resolve(tmpdir(), "pal-copilot-ctx-"));
  copilotDir = resolve(sandbox, "copilot");
  const telos = resolve(sandbox, "home", "telos");
  mkdirSync(telos, { recursive: true });
  mkdirSync(copilotDir, { recursive: true });
  writeFileSync(resolve(telos, "GOALS.md"), "# Goals\n\n- ship PAL\n", "utf-8");
  result = runLoadContext();
});

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe("LoadContext on Copilot", () => {
  test("exits 0 so a fail-open runtime does not log a hook failure", () => {
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
  });

  /**
   * The CLI parses stdout as the hook output JSON. Plain text, or writing only
   * the instructions file, delivers no context to a Copilot CLI session.
   */
  test("emits JSON carrying additionalContext, the CLI's only injection channel", () => {
    const parsed = JSON.parse(result.stdout) as { additionalContext?: unknown };
    expect(typeof parsed.additionalContext).toBe("string");
    expect((parsed.additionalContext as string).length).toBeGreaterThan(0);
  });

  test("still writes the instructions file the VS Code extension reads", () => {
    const written = resolve(copilotDir, "instructions", "pal-session.instructions.md");
    expect(existsSync(written)).toBe(true);
  });
});
