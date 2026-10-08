import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const TEST_HOME = resolve(import.meta.dir, "../.test-install-home");
const CLAUDE_DIR = resolve(TEST_HOME, ".claude");
const OPENCODE_DIR = resolve(TEST_HOME, ".opencode");
const CURSOR_DIR = resolve(TEST_HOME, ".cursor");
const COPILOT_DIR = resolve(TEST_HOME, ".copilot");
const CODEX_DIR = resolve(TEST_HOME, ".codex");
const GEMINI_DIR = resolve(TEST_HOME, ".gemini");
const AGENTS_DIR = resolve(TEST_HOME, ".agents");
const onWindows = process.platform === "win32";

function pal(...args: string[]) {
  return spawnSync("bun", ["run", CLI, ...args], {
    env: {
      ...process.env,
      PAL_HOME: TEST_HOME,
      PAL_SKIP_DOCTOR: "1",
      PAL_SKIP_BROWSER_INSTALL: "1",
      PAL_CLAUDE_DIR: CLAUDE_DIR,
      PAL_OPENCODE_DIR: OPENCODE_DIR,
      PAL_CURSOR_DIR: CURSOR_DIR,
      PAL_COPILOT_DIR: COPILOT_DIR,
      PAL_CODEX_DIR: CODEX_DIR,
      PAL_GEMINI_DIR: GEMINI_DIR,
      PAL_AGENTS_DIR: AGENTS_DIR,
    },
    encoding: "utf-8",
    timeout: 90000,
  });
}

beforeAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

describe("pal cli install (smoke)", () => {
  test("install --claude wires settings, skills, agents", () => {
    const result = pal("cli", "install", "--claude");
    expect(result.status).toBe(0);

    const settings = resolve(CLAUDE_DIR, "settings.json");
    expect(existsSync(settings)).toBe(true);

    const skills = resolve(CLAUDE_DIR, "skills");
    expect(existsSync(skills)).toBe(true);
    expect(readdirSync(skills).length).toBeGreaterThan(0);

    const agents = resolve(CLAUDE_DIR, "agents");
    expect(existsSync(agents)).toBe(true);
    expect(readdirSync(agents).length).toBeGreaterThan(0);
  }, 90000);

  test("install --opencode lands plugin and agents", () => {
    const configFile = resolve(OPENCODE_DIR, "config.json");
    const userRules = { "~/secrets/**": "deny" };
    mkdirSync(OPENCODE_DIR, { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({ permission: { external_directory: userRules } })
    );
    const result = pal("cli", "install", "--opencode");
    expect(result.status).toBe(0);
    expect(existsSync(OPENCODE_DIR)).toBe(true);
    expect(existsSync(resolve(OPENCODE_DIR, "plugins", "pal-plugin.ts"))).toBe(true);
    const config = JSON.parse(readFileSync(configFile, "utf-8"));
    expect(config.permission.external_directory).toEqual({
      ...userRules,
      [`${TEST_HOME.replaceAll("\\", "/")}/**`]: "allow",
    });

    expect(pal("cli", "uninstall", "--opencode").status).toBe(0);
    const cleaned = JSON.parse(readFileSync(configFile, "utf-8"));
    expect(cleaned.permission.external_directory).toEqual(userRules);
  }, 90000);

  test("install --cursor wires hooks, skills, agents", () => {
    const result = pal("cli", "install", "--cursor");
    expect(result.status).toBe(0);

    expect(existsSync(resolve(CURSOR_DIR, "hooks.json"))).toBe(true);

    const skills = resolve(CURSOR_DIR, "skills");
    expect(existsSync(skills)).toBe(true);
    expect(readdirSync(skills).length).toBeGreaterThan(0);

    const agents = resolve(CURSOR_DIR, "agents");
    expect(existsSync(agents)).toBe(true);
    expect(readdirSync(agents).length).toBeGreaterThan(0);

    const statuslineScript =
      process.platform === "win32" ? "statusline.ps1" : "statusline.sh";
    const statuslineCommand =
      process.platform === "win32"
        ? "powershell -NoProfile -File ~/.cursor/statusline.ps1"
        : "~/.cursor/statusline.sh";

    expect(existsSync(resolve(CURSOR_DIR, statuslineScript))).toBe(true);
    const cliConfig = JSON.parse(
      readFileSync(resolve(CURSOR_DIR, "cli-config.json"), "utf-8")
    ) as { statusLine?: { command?: string } };
    expect(cliConfig.statusLine?.command).toBe(statuslineCommand);
  }, 90000);

  test("install --codex manages only PAL-owned allowlist rules", () => {
    rmSync(CODEX_DIR, { recursive: true, force: true });
    const rulesFile = resolve(CODEX_DIR, "rules", "default.rules");
    mkdirSync(resolve(CODEX_DIR, "rules"), { recursive: true });
    writeFileSync(
      rulesFile,
      [
        'prefix_rule(pattern=["gh", "pr", "view"], decision="prompt")',
        "# BEGIN PAL MANAGED CODEX RULES",
        'prefix_rule(pattern=["bun", "/stale/pal/tools/project.ts"], decision="allow")',
        "# END PAL MANAGED CODEX RULES",
        "",
      ].join("\n"),
      "utf-8"
    );

    const installResult = pal("cli", "install", "--codex");
    expect(installResult.status).toBe(0);

    const installedRules = readFileSync(rulesFile, "utf-8");
    expect(installedRules).toContain(
      'prefix_rule(pattern=["gh", "pr", "view"], decision="prompt")'
    );
    expect(installedRules).toContain("# BEGIN PAL MANAGED CODEX RULES");
    expect(installedRules).toContain('pattern = ["bun", "~/.pal/tools/project.ts"]');
    expect(installedRules).not.toContain("/stale/pal/tools/project.ts");
    expect(installedRules.match(/# BEGIN PAL MANAGED CODEX RULES/g)?.length).toBe(1);

    expect(existsSync(resolve(CODEX_DIR, "hooks.json"))).toBe(true);
    expect(existsSync(resolve(CODEX_DIR, "skills"))).toBe(true);
    const installedConfig = readFileSync(resolve(CODEX_DIR, "config.toml"), "utf-8");
    expect(installedConfig).toContain('tui.status_line = ["model-with-reasoning"');
    expect(installedConfig).toContain('"context-remaining"');
    expect(installedConfig).toContain('"five-hour-limit"');
    expect(installedConfig).toContain('"weekly-limit"');
    expect(installedConfig).toContain('"codex-version"');

    const uninstallResult = pal("cli", "uninstall", "--codex");
    expect(uninstallResult.status).toBe(0);

    const uninstalledRules = readFileSync(rulesFile, "utf-8");
    expect(uninstalledRules).toContain(
      'prefix_rule(pattern=["gh", "pr", "view"], decision="prompt")'
    );
    expect(uninstalledRules).not.toContain("# BEGIN PAL MANAGED CODEX RULES");
    expect(uninstalledRules).not.toContain("~/.pal/tools/project.ts");
    const uninstalledConfig = readFileSync(resolve(CODEX_DIR, "config.toml"), "utf-8");
    expect(uninstalledConfig).not.toContain('tui.status_line = ["model-with-reasoning"');
  }, 90000);

  test("install --antigravity lands everything in one plugin, uninstall removes only it", () => {
    const plugin = resolve(GEMINI_DIR, "config", "plugins", "pal");
    const settingsFile = resolve(GEMINI_DIR, "antigravity-cli", "settings.json");
    const userSettings = {
      colorScheme: "tokyo night",
      permissions: { allow: ["command(gh pr list)"] },
    };
    mkdirSync(resolve(GEMINI_DIR, "antigravity-cli"), { recursive: true });
    writeFileSync(settingsFile, JSON.stringify(userSettings));
    expect(pal("cli", "install", "--antigravity").status).toBe(0);

    const settings = JSON.parse(readFileSync(settingsFile, "utf-8"));
    expect(settings.colorScheme).toBe("tokyo night");
    expect(settings.permissions.allow).toContain("command(gh pr list)");
    expect(settings.permissions.allow).toContain("command(grep)");
    expect(settings.permissions.allow).toContain("command(pal cli project)");
    const statuslineScript = onWindows ? "statusline.ps1" : "statusline.sh";
    expect(settings.statusLine.command).toBe(
      onWindows
        ? "powershell -NoProfile -ExecutionPolicy Bypass -File ~/.gemini/antigravity-cli/statusline.ps1"
        : "~/.gemini/antigravity-cli/statusline.sh"
    );
    expect(existsSync(resolve(GEMINI_DIR, "antigravity-cli", statuslineScript))).toBe(
      true
    );

    const manifest = JSON.parse(readFileSync(resolve(plugin, "plugin.json"), "utf-8"));
    expect(manifest.name).toBe("pal");
    const skills = readdirSync(resolve(plugin, "skills"));
    expect(skills.length).toBeGreaterThan(0);
    expect(existsSync(resolve(plugin, "skills", skills[0], "SKILL.md"))).toBe(true);
    const instructions = readFileSync(resolve(plugin, "rules", "pal.md"), "utf-8");
    expect(instructions).toStartWith("---\ntrigger: always_on\n");
    expect(instructions).toContain("# PAL");
    const steering = readFileSync(resolve(plugin, "rules", "pal-steering.md"), "utf-8");
    expect(steering).toStartWith(
      "---\ntrigger: always_on\ndescription: PAL steering rules\n"
    );
    const hooks = readFileSync(resolve(plugin, "hooks.json"), "utf-8");
    const commands = Array.from(hooks.matchAll(/"command": "([^"]+)"/g), (m) => m[1]);
    expect(commands.length).toBe(5);
    for (const command of commands) {
      expect(command).not.toContain("{{PKG_ROOT}}");
      expect(command).toEndWith(" --agent=antigravity");
      expect(existsSync(command.split(" ")[2])).toBe(true);
    }
    expect(Object.keys(JSON.parse(hooks).pal)).toEqual([
      "PreInvocation",
      "PreToolUse",
      "PostToolUse",
      "Stop",
    ]);
    const author = readFileSync(resolve(plugin, "agents", "skill-author.md"), "utf-8");
    expect(author).toContain("\nmodel: pro\n");
    expect(author).toContain("\nmainAgent: false\n");
    expect(author).toContain("\n  - write_to_file\n");
    expect(author).not.toContain("fable");

    expect(pal("cli", "uninstall", "--antigravity").status).toBe(0);
    expect(existsSync(plugin)).toBe(false);
    expect(JSON.parse(readFileSync(settingsFile, "utf-8"))).toEqual(userSettings);
    expect(existsSync(resolve(GEMINI_DIR, "antigravity-cli", statuslineScript))).toBe(
      false
    );
    expect(existsSync(resolve(TEST_HOME, "skills", skills[0], "SKILL.md"))).toBe(true);
  }, 90000);

  test("install is idempotent — second run preserves files", () => {
    expect(pal("cli", "install", "--claude").status).toBe(0);
    const before = readdirSync(resolve(CLAUDE_DIR, "skills")).length;
    const result = pal("cli", "install", "--claude");
    expect(result.status).toBe(0);
    const after = readdirSync(resolve(CLAUDE_DIR, "skills")).length;
    expect(after).toBe(before);
  }, 180000);
});
