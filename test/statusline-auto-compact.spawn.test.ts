import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { POWERSHELL_SPAWN_TEST_MS, SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

const isWindows = process.platform === "win32";
setDefaultTimeout(isWindows ? POWERSHELL_SPAWN_TEST_MS : SPAWN_HEAVY_TEST_MS);

const repo = resolve(import.meta.dir, "..");
const MODEL_ID = "claude-opus-5-5";

let HOME: string;
let PROJECT: string;

function writeSettings(dir: string, settings: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "settings.json"), JSON.stringify(settings));
}

function statuslineEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME, USERPROFILE: HOME };
  delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  delete env.CLAUDE_CONFIG_DIR;
  env.DARK_FACTORY_HOME = "";
  env.CLAUDECODE = "1";

  return { ...env, ...extra };
}

function render(extraEnv: Record<string, string> = {}): string {
  const input = JSON.stringify({
    model: { id: MODEL_ID, display_name: "Opus" },
    workspace: { current_dir: PROJECT, project_dir: PROJECT },
    context_window: {
      used_percentage: 45,
      remaining_percentage: 55,
      total_input_tokens: 450000,
      context_window_size: 1000000,
    },
  });
  const env = statuslineEnv(extraEnv);
  const script = resolve(repo, "assets", isWindows ? "statusline.ps1" : "statusline.sh");
  const run = isWindows
    ? spawnSync(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
        { input, encoding: "utf-8", env }
      )
    : spawnSync("bash", [script], { input, encoding: "utf-8", env });

  return run.stdout ?? "";
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  PROJECT = resolve(HOME, "git", "app");
  mkdirSync(PROJECT, { recursive: true });
});

describe("the status line's auto-compact window", () => {
  test("uses the full model window when no cap is set", () => {
    expect(render()).toContain("55% free");
  });

  test("measures usage against autoCompactWindow in the user settings", () => {
    writeSettings(resolve(HOME, ".claude"), { autoCompactWindow: 500000 });

    expect(render()).toContain("10% free");
  });

  test("reads the user settings from CLAUDE_CONFIG_DIR when it is set", () => {
    const configDir = resolve(HOME, "claude-config");
    writeSettings(configDir, { autoCompactWindow: 500000 });

    expect(render({ CLAUDE_CONFIG_DIR: configDir })).toContain("10% free");
  });

  test("prefers the per-model window over the top-level one", () => {
    writeSettings(resolve(HOME, ".claude"), {
      autoCompactWindow: 500000,
      modelSettings: { [MODEL_ID]: { autoCompactWindow: 900000 } },
    });

    expect(render()).toContain("50% free");
  });

  test("prefers the project settings over the user settings", () => {
    writeSettings(resolve(HOME, ".claude"), { autoCompactWindow: 900000 });
    writeSettings(resolve(PROJECT, ".claude"), { autoCompactWindow: 500000 });

    expect(render()).toContain("10% free");
  });

  test("still honours the environment variable", () => {
    expect(render({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" })).toContain("10% free");
  });

  test("reads the variable from the env block of the settings", () => {
    writeSettings(resolve(HOME, ".claude"), {
      env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" },
    });

    expect(render()).toContain("10% free");
  });

  test("ignores the cap outside Claude Code", () => {
    writeSettings(resolve(HOME, ".claude"), { autoCompactWindow: 500000 });

    expect(render({ CLAUDECODE: "" })).toContain("55% free");
  });
});
