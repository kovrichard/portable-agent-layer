import { beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { linkDir } from "./lib/links";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";
import { describeUnresolvedSkills } from "./lib/unresolved-skills-report";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const REPO_ROOT = resolve(import.meta.dir, "..");
const REPO_SKILLS = resolve(REPO_ROOT, "assets/skills");
const SANDBOX = freshTestDir(import.meta.file);
const at = (...parts: string[]) => resolve(SANDBOX, ...parts);

const env = {
  ...process.env,
  PAL_PKG: REPO_ROOT,
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

const runPalWith = (runEnv: Record<string, string | undefined>, ...args: string[]) =>
  spawnSync("bun", ["run", CLI, "cli", ...args], {
    env: runEnv,
    encoding: "utf-8",
    timeout: SPAWN_TIMEOUT,
  });

const runPal = (...args: string[]) => runPalWith(env, ...args);

function pal(...args: string[]) {
  const result = runPal(...args);
  if (result.status !== 0)
    throw new Error(
      `pal ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`
    );
}

const shippedSkills = () =>
  readdirSync(REPO_SKILLS).filter((name) =>
    existsSync(resolve(REPO_SKILLS, name, "SKILL.md"))
  );

const unresolvedIn = (dir: string) =>
  shippedSkills().filter((name) => !existsSync(resolve(dir, name, "SKILL.md")));

function expectSkillsResolve(dir: string, step: "install" | "uninstall") {
  const unresolved = unresolvedIn(dir);
  if (unresolved.length > 0)
    throw new Error(
      `skills unresolved in ${dir} after ${step}\n${describeUnresolvedSkills(dir, unresolved)}`
    );
}

beforeEach(() => {
  removeOnceReleased(SANDBOX);
});

describe("a per-agent uninstall", () => {
  test(
    "leaves the shared skill store and other agents' skills resolving",
    () => {
      pal("install", "--claude", "--cursor");
      expectSkillsResolve(at(".pal", "skills"), "install");
      expectSkillsResolve(at(".claude", "skills"), "install");
      expectSkillsResolve(at(".agents", "skills"), "install");
      pal("uninstall", "--cursor");

      expectSkillsResolve(at(".pal", "skills"), "uninstall");
      expectSkillsResolve(at(".claude", "skills"), "uninstall");
      expectSkillsResolve(at(".agents", "skills"), "uninstall");
    },
    INSTALL_THEN_UNINSTALL
  );

  test(
    "removes the uninstalled agent's own skill links",
    () => {
      pal("install", "--claude", "--cursor");
      expectSkillsResolve(at(".cursor", "skills"), "install");
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
      expectSkillsResolve(at(".claude", "skills"), "install");
      pal("uninstall", "--opencode");

      expectSkillsResolve(at(".claude", "skills"), "uninstall");
    },
    INSTALL_THEN_UNINSTALL
  );
});

describe("an install whose package has no skills folder", () => {
  test(
    "exits 1 and names the missing folder",
    () => {
      const emptyPkg = at("empty-pkg");
      mkdirSync(resolve(emptyPkg, "assets"), { recursive: true });
      linkDir(
        resolve(REPO_ROOT, "assets/templates"),
        resolve(emptyPkg, "assets", "templates")
      );
      writeFileSync(resolve(emptyPkg, "package.json"), '{"name":"x","version":"0.0.0"}');
      const result = runPalWith({ ...env, PAL_PKG: emptyPkg }, "install", "--claude");

      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain(
        resolve(emptyPkg, "assets", "skills")
      );
    },
    SPAWN_TIMEOUT
  );
});

describe.skipIf(process.platform === "win32")(
  "an install that cannot link a skill",
  () => {
    test(
      "exits non-zero and names the skill and the error",
      () => {
        const store = at(".pal", "skills");
        mkdirSync(store, { recursive: true });
        chmodSync(store, 0o500);
        try {
          const result = runPal("install", "--claude");
          expect(result.status).toBe(1);
          expect(result.stdout + result.stderr).toMatch(/Could not install skill \S+ — /);
        } finally {
          chmodSync(store, 0o700);
        }
      },
      SPAWN_TIMEOUT
    );
  }
);
