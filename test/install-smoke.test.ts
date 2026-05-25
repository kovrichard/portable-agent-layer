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
const CODEX_DIR = resolve(TEST_HOME, ".codex");
const AGENTS_DIR = resolve(TEST_HOME, ".agents");

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
      PAL_CODEX_DIR: CODEX_DIR,
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
    const result = pal("cli", "install", "--opencode");
    expect(result.status).toBe(0);
    expect(existsSync(OPENCODE_DIR)).toBe(true);
    expect(existsSync(resolve(OPENCODE_DIR, "plugins", "pal-plugin.ts"))).toBe(true);
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

    const uninstallResult = pal("cli", "uninstall", "--codex");
    expect(uninstallResult.status).toBe(0);

    const uninstalledRules = readFileSync(rulesFile, "utf-8");
    expect(uninstalledRules).toContain(
      'prefix_rule(pattern=["gh", "pr", "view"], decision="prompt")'
    );
    expect(uninstalledRules).not.toContain("# BEGIN PAL MANAGED CODEX RULES");
    expect(uninstalledRules).not.toContain("~/.pal/tools/project.ts");
  }, 90000);

  test("install is idempotent — second run preserves files", () => {
    const before = readdirSync(resolve(CLAUDE_DIR, "skills")).length;
    const result = pal("cli", "install", "--claude");
    expect(result.status).toBe(0);
    const after = readdirSync(resolve(CLAUDE_DIR, "skills")).length;
    expect(after).toBe(before);
  }, 90000);
});
