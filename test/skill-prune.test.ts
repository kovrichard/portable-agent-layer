import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const REPO_SKILLS = resolve(import.meta.dir, "../assets/skills");
const HOME = resolve(import.meta.dir, "../.test-home-skill-prune");
const PAL_SKILLS = resolve(HOME, ".pal/skills");
const CLAUDE_SKILLS = resolve(HOME, ".claude/skills");

const env = {
  ...process.env,
  PAL_HOME: resolve(HOME, ".pal"),
  PAL_SKIP_DOCTOR: "1",
  PAL_SKIP_BROWSER_INSTALL: "1",
  PAL_CLAUDE_DIR: resolve(HOME, ".claude"),
  PAL_CURSOR_DIR: resolve(HOME, ".cursor"),
  PAL_COPILOT_DIR: resolve(HOME, ".copilot"),
  PAL_CODEX_DIR: resolve(HOME, ".codex"),
  PAL_AGENTS_DIR: resolve(HOME, ".agents"),
};

function pal(...args: string[]) {
  return spawnSync("bun", ["run", CLI, "cli", ...args], {
    env,
    encoding: "utf-8",
    timeout: 90000,
  });
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// Rebuilt before EVERY test, not once: the install case prunes `renamed-away`
// and links every shipped skill into the store, so a shared fixture would leave
// whichever test ran second asserting against the other's leftovers. Bun
// randomises test order per seed, which turns that into an intermittent failure.
beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(PAL_SKILLS, { recursive: true });
  mkdirSync(CLAUDE_SKILLS, { recursive: true });

  // A shipped skill that was renamed: both discovery links now dangle.
  symlinkSync(
    resolve(REPO_SKILLS, "renamed-away"),
    resolve(PAL_SKILLS, "renamed-away"),
    "dir"
  );
  symlinkSync(
    resolve(PAL_SKILLS, "renamed-away"),
    resolve(CLAUDE_SKILLS, "renamed-away"),
    "dir"
  );

  // A personal skill: a real directory, never a link.
  mkdirSync(resolve(PAL_SKILLS, "mine"), { recursive: true });
  writeFileSync(resolve(PAL_SKILLS, "mine/SKILL.md"), "---\nname: mine\n---\n");

  // Dangling links the user made themselves — targets outside any PAL tree.
  symlinkSync(resolve(HOME, "elsewhere"), resolve(PAL_SKILLS, "foreign"), "dir");
  symlinkSync(resolve(HOME, "gone"), resolve(CLAUDE_SKILLS, "user-link"), "dir");
});

afterAll(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("stale shipped-skill links", () => {
  test("skill doctor --all skips a dangling link and names it", () => {
    const res = pal("skill", "doctor", "--all");
    expect(res.stdout + res.stderr).not.toContain("ENOENT");
    expect(res.stdout).toContain("Skipped renamed-away");
    expect(res.stdout).toContain("1 skills —");
    expect(res.stdout).toContain("mine");
  });

  test("install prunes PAL-owned dangling links and leaves everything else", () => {
    const res = pal("install", "--claude");
    expect(res.status).toBe(0);

    expect(isSymlink(resolve(PAL_SKILLS, "renamed-away"))).toBe(false);
    expect(isSymlink(resolve(CLAUDE_SKILLS, "renamed-away"))).toBe(false);

    expect(existsSync(resolve(PAL_SKILLS, "mine/SKILL.md"))).toBe(true);
    expect(isSymlink(resolve(PAL_SKILLS, "foreign"))).toBe(true);
    expect(isSymlink(resolve(CLAUDE_SKILLS, "user-link"))).toBe(true);
  }, 90000);
});
