import { beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const REPO_SKILLS = resolve(import.meta.dir, "../assets/skills");
const SANDBOX = freshTestDir(import.meta.file);
const at = (...parts: string[]) => resolve(SANDBOX, ...parts);

const env = {
  ...process.env,
  PAL_HOME: at(".pal"),
  PAL_SKIP_DOCTOR: "1",
  PAL_SKIP_BROWSER_INSTALL: "1",
  PAL_CLAUDE_DIR: at(".claude"),
  PAL_OPENCODE_DIR: at(".opencode"),
  PAL_CURSOR_DIR: at(".cursor"),
  PAL_COPILOT_DIR: at(".copilot"),
  PAL_CODEX_DIR: at(".codex"),
  PAL_AGENTS_DIR: at(".agents"),
  PAL_GEMINI_DIR: at(".gemini"),
};

const SPAWN_TIMEOUT = 90_000;
const INSTALL_THEN_UNINSTALL = 2 * SPAWN_TIMEOUT;

function pal(...args: string[]) {
  const result = spawnSync("bun", ["run", CLI, "cli", ...args], {
    env,
    encoding: "utf-8",
    timeout: SPAWN_TIMEOUT,
  });
  expect(result.status).toBe(0);
}

const shippedSkills = () =>
  readdirSync(REPO_SKILLS).filter((name) =>
    existsSync(resolve(REPO_SKILLS, name, "SKILL.md"))
  );

const unresolvedIn = (dir: string) =>
  shippedSkills().filter((name) => !existsSync(resolve(dir, name, "SKILL.md")));

beforeEach(() => {
  removeOnceReleased(SANDBOX);
});

describe("a per-agent uninstall", () => {
  test(
    "leaves the shared skill store and other agents' skills resolving",
    () => {
      pal("install", "--claude", "--cursor");
      pal("uninstall", "--cursor");

      expect(unresolvedIn(at(".pal", "skills"))).toEqual([]);
      expect(unresolvedIn(at(".claude", "skills"))).toEqual([]);
      expect(unresolvedIn(at(".agents", "skills"))).toEqual([]);
    },
    INSTALL_THEN_UNINSTALL
  );

  test(
    "removes the uninstalled agent's own skill links",
    () => {
      pal("install", "--claude", "--cursor");
      pal("uninstall", "--cursor");

      expect(
        shippedSkills().filter((name) => existsSync(at(".cursor", "skills", name)))
      ).toEqual([]);
    },
    INSTALL_THEN_UNINSTALL
  );

  test(
    "leaves Claude's skill links alone when opencode is uninstalled",
    () => {
      pal("install", "--claude", "--opencode");
      pal("uninstall", "--opencode");

      expect(unresolvedIn(at(".claude", "skills"))).toEqual([]);
    },
    INSTALL_THEN_UNINSTALL
  );
});
