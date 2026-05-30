import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const HOME = resolve(import.meta.dir, "../.test-home-skill-link");

const env = {
  ...process.env,
  PAL_HOME: resolve(HOME, ".pal"),
  PAL_CLAUDE_DIR: resolve(HOME, ".claude"),
  PAL_CURSOR_DIR: resolve(HOME, ".cursor"),
  PAL_COPILOT_DIR: resolve(HOME, ".copilot"),
  PAL_CODEX_DIR: resolve(HOME, ".codex"),
  PAL_AGENTS_DIR: resolve(HOME, ".agents"),
};

function skillLink(name: string) {
  return spawnSync("bun", ["run", CLI, "cli", "skill", "link", name], {
    env,
    encoding: "utf-8",
    timeout: 15000,
  });
}

beforeAll(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  // A personal skill already scaffolded under ~/.pal/skills/
  mkdirSync(resolve(HOME, ".pal/skills/my-skill"), { recursive: true });
  writeFileSync(
    resolve(HOME, ".pal/skills/my-skill/SKILL.md"),
    "---\nname: my-skill\n---\n"
  );
  // claude + cursor are "installed" (their skills dirs exist); copilot + codex are not.
  mkdirSync(resolve(HOME, ".claude/skills"), { recursive: true });
  mkdirSync(resolve(HOME, ".cursor/skills"), { recursive: true });
});

afterAll(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("pal cli skill link", () => {
  test("links a personal skill into installed agents only", () => {
    const res = skillLink("my-skill");
    expect(res.status).toBe(0);

    const claudeLink = resolve(HOME, ".claude/skills/my-skill");
    const cursorLink = resolve(HOME, ".cursor/skills/my-skill");
    const codexLink = resolve(HOME, ".codex/skills/my-skill");

    // installed agents get a discovery symlink
    expect(lstatSync(claudeLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(cursorLink).isSymbolicLink()).toBe(true);
    // the symlink resolves to the SKILL.md (discoverable)
    expect(existsSync(resolve(claudeLink, "SKILL.md"))).toBe(true);
    // uninstalled agent is skipped — no link, no stray dir
    expect(existsSync(codexLink)).toBe(false);
  });

  test("is idempotent — re-linking succeeds", () => {
    const res = skillLink("my-skill");
    expect(res.status).toBe(0);
    expect(lstatSync(resolve(HOME, ".claude/skills/my-skill")).isSymbolicLink()).toBe(
      true
    );
  });

  test("fails when the skill does not exist under ~/.pal/skills/", () => {
    const res = skillLink("ghost-skill");
    expect(res.status).toBe(1);
    expect(existsSync(resolve(HOME, ".claude/skills/ghost-skill"))).toBe(false);
  });

  test("errors with usage when no name is given", () => {
    const res = spawnSync("bun", ["run", CLI, "cli", "skill", "link"], {
      env,
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(res.status).toBe(1);
  });
});
