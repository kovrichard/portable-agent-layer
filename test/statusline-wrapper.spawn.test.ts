import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assets } from "../src/core/paths";
import { installStatusline } from "../src/targets/statusline";
import { POWERSHELL_SPAWN_TEST_MS, SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

const isWindows = process.platform === "win32";
setDefaultTimeout(isWindows ? POWERSHELL_SPAWN_TEST_MS : SPAWN_HEAVY_TEST_MS);

const SCRIPT = isWindows ? "statusline.ps1" : "statusline.sh";
const packageScript = () =>
  isWindows ? assets.statuslineScriptPs1() : assets.statuslineScriptBash();

let HOME: string;
let claudeDir: string;

function runInstalled(): string {
  const input = JSON.stringify({
    model: { display_name: "Opus" },
    workspace: { current_dir: HOME },
  });
  const env = { ...process.env, HOME, USERPROFILE: HOME, DARK_FACTORY_HOME: "" };
  const installed = resolve(claudeDir, SCRIPT);
  const run = isWindows
    ? spawnSync(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installed],
        { input, encoding: "utf-8", env }
      )
    : spawnSync(installed, [], { input, encoding: "utf-8", env });

  return run.stdout ?? "";
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  claudeDir = resolve(HOME, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  process.env.PAL_CLAUDE_DIR = claudeDir;
});

describe("the installed status line", () => {
  test("runs the package's script instead of holding a copy of it", () => {
    expect(installStatusline("claude")).toBe(true);

    const installed = readFileSync(resolve(claudeDir, SCRIPT), "utf-8");
    expect(installed).toContain(packageScript());
    expect(installed).not.toContain("context_window");
  });

  test("renders the status line through the package's script", () => {
    installStatusline("claude");

    expect(runInstalled()).toContain("[Opus]");
  });
});
