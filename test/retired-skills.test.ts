import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { copySkills, RETIRED_SKILLS } from "../src/targets/skills";
import { linkDir } from "./lib/links";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const ROOT = testHome(import.meta.file, "root");
const PKG_SKILLS = resolve(ROOT, "pkg/assets/skills");
const PAL_SKILLS = resolve(ROOT, "home/skills");
const AGENT_SKILLS = resolve(ROOT, ".claude/skills");
const ELSEWHERE = resolve(ROOT, "elsewhere");
const MANIFEST = resolve(import.meta.dir, "shipped-surface.json");

const ENV = {
  PAL_PKG: resolve(ROOT, "pkg"),
  PAL_HOME: resolve(ROOT, "home"),
  PAL_CLAUDE_DIR: resolve(ROOT, ".claude"),
  PAL_OPENCODE_DIR: resolve(ROOT, ".opencode"),
  PAL_CURSOR_DIR: resolve(ROOT, ".cursor"),
  PAL_COPILOT_DIR: resolve(ROOT, ".copilot"),
  PAL_CODEX_DIR: resolve(ROOT, ".codex"),
  PAL_GEMINI_DIR: resolve(ROOT, ".gemini"),
  PAL_AGENTS_DIR: resolve(ROOT, ".agents"),
};

function installSkillsFromTempPackage(): number {
  const previous = Object.keys(ENV).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, ENV);

  try {
    return copySkills(AGENT_SKILLS);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function writeSkill(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "SKILL.md"), "---\nname: x\n---\n");
}

function entryExists(path: string): boolean {
  try {
    lstatSync(path);

    return true;
  } catch {
    return false;
  }
}

function isLink(path: string): boolean {
  return entryExists(path) && lstatSync(path).isSymbolicLink();
}

function linkBothWays(name: string): void {
  linkDir(resolve(PKG_SKILLS, name), resolve(PAL_SKILLS, name));
  linkDir(resolve(PAL_SKILLS, name), resolve(AGENT_SKILLS, name));
}

function retiredLinksInManifest(): string[] {
  const { retired } = JSON.parse(readFileSync(MANIFEST, "utf-8")) as {
    retired: string[];
  };
  const storeLink = /^home\/skills\/([^ ]+) -> \{pkg\}\/assets\/skills\/\1$/;

  return retired.flatMap((item) => item.match(storeLink)?.[1] ?? []).sort();
}

beforeEach(() => {
  removeOnceReleased(ROOT);

  for (const name of ["kept", "opinion", "pal-reflect"]) {
    writeSkill(resolve(PKG_SKILLS, name));
  }

  mkdirSync(resolve(PKG_SKILLS, "no-skill-md"), { recursive: true });
  mkdirSync(PAL_SKILLS, { recursive: true });
  mkdirSync(AGENT_SKILLS, { recursive: true });
});

describe("retired skills", () => {
  test("a retired skill shipped with a SKILL.md is not linked", () => {
    expect(installSkillsFromTempPackage()).toBe(1);

    for (const name of ["opinion", "pal-reflect"]) {
      expect(entryExists(resolve(PAL_SKILLS, name))).toBe(false);
      expect(entryExists(resolve(AGENT_SKILLS, name))).toBe(false);
    }

    expect(isLink(resolve(PAL_SKILLS, "kept"))).toBe(true);
    expect(isLink(resolve(AGENT_SKILLS, "kept"))).toBe(true);
    expect(entryExists(resolve(PAL_SKILLS, "no-skill-md"))).toBe(false);
  });

  test("links of a retired skill are removed though they still resolve", () => {
    linkBothWays("opinion");
    linkBothWays("pal-reflect");

    installSkillsFromTempPackage();

    for (const name of ["opinion", "pal-reflect"]) {
      expect(entryExists(resolve(PAL_SKILLS, name))).toBe(false);
      expect(entryExists(resolve(AGENT_SKILLS, name))).toBe(false);
      expect(existsSync(resolve(PKG_SKILLS, name, "SKILL.md"))).toBe(true);
    }
  });

  test("a real folder named like a retired skill keeps it and its agent link", () => {
    writeSkill(resolve(PAL_SKILLS, "opinion"));
    linkDir(resolve(PAL_SKILLS, "opinion"), resolve(AGENT_SKILLS, "opinion"));

    installSkillsFromTempPackage();

    expect(existsSync(resolve(PAL_SKILLS, "opinion", "SKILL.md"))).toBe(true);
    expect(isLink(resolve(PAL_SKILLS, "opinion"))).toBe(false);
    expect(isLink(resolve(AGENT_SKILLS, "opinion"))).toBe(true);
  });

  test("a retired name linked outside PAL's trees is left alone", () => {
    writeSkill(resolve(ELSEWHERE, "opinion"));
    linkDir(resolve(ELSEWHERE, "opinion"), resolve(PAL_SKILLS, "opinion"));
    linkDir(resolve(ELSEWHERE, "opinion"), resolve(AGENT_SKILLS, "pal-reflect"));

    installSkillsFromTempPackage();

    expect(isLink(resolve(PAL_SKILLS, "opinion"))).toBe(true);
    expect(isLink(resolve(AGENT_SKILLS, "pal-reflect"))).toBe(true);
  });

  test("a renamed skill's dangling links are still pruned", () => {
    linkBothWays("renamed-away");

    installSkillsFromTempPackage();

    expect(entryExists(resolve(PAL_SKILLS, "renamed-away"))).toBe(false);
    expect(entryExists(resolve(AGENT_SKILLS, "renamed-away"))).toBe(false);
  });

  test("the retired names equal the retired skill links in the shipped-surface manifest", () => {
    expect([...RETIRED_SKILLS].sort()).toEqual(retiredLinksInManifest());
  });
});
