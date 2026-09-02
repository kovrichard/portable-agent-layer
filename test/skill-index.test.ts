import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { generateSkillIndex, linkPersonalSkill } from "../src/targets/lib";

const HOME = resolve(import.meta.dir, "../.test-home-skill-index");
const AGENT_DIRS = {
  PAL_CLAUDE_DIR: resolve(HOME, ".claude"),
  PAL_CURSOR_DIR: resolve(HOME, ".cursor"),
  PAL_COPILOT_DIR: resolve(HOME, ".copilot"),
  PAL_CODEX_DIR: resolve(HOME, ".codex"),
  PAL_AGENTS_DIR: resolve(HOME, ".agents"),
};
const saved: Record<string, string | undefined> = {};

function writeSkill(name: string, frontmatter: string | null, body = "text") {
  const dir = resolve(HOME, "skills", name);
  mkdirSync(dir, { recursive: true });
  const content = frontmatter === null ? body : `---\n${frontmatter}\n---\n${body}`;
  writeFileSync(resolve(dir, "SKILL.md"), content);
  return dir;
}

function readIndex() {
  return JSON.parse(
    readFileSync(resolve(HOME, "memory", "state", "skill-index.json"), "utf-8")
  );
}

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  saved.PAL_HOME = process.env.PAL_HOME;
  process.env.PAL_HOME = HOME;
  for (const [key, value] of Object.entries(AGENT_DIRS)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of ["PAL_HOME", ...Object.keys(AGENT_DIRS)]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("generateSkillIndex", () => {
  test("returns 0 and writes nothing when there is no skills directory", () => {
    expect(generateSkillIndex()).toBe(0);
    expect(existsSync(resolve(HOME, "memory", "state", "skill-index.json"))).toBe(false);
  });

  test("indexes a skill by its frontmatter name and description", () => {
    writeSkill("alpha", "name: alpha\ndescription: Does a thing.");

    expect(generateSkillIndex()).toBe(1);
    const index = readIndex();
    expect(index.totalSkills).toBe(1);
    expect(index.skills.alpha.name).toBe("alpha");
    expect(index.skills.alpha.description).toBe("Does a thing.");
    expect(index.generated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("skips a skill with no frontmatter", () => {
    writeSkill("bare", null);

    expect(generateSkillIndex()).toBe(0);
  });

  test("skips a skill whose frontmatter has no name", () => {
    writeSkill("nameless", "description: Has no name field.");

    expect(generateSkillIndex()).toBe(0);
  });

  test("indexes a named skill that has no description", () => {
    writeSkill("terse", "name: terse");

    expect(generateSkillIndex()).toBe(1);
    expect(readIndex().skills.terse.description).toBe("");
  });

  test("strips surrounding quotes from the description", () => {
    writeSkill("quoted", 'name: quoted\ndescription: "Quoted text."');

    expect(readIndexAfterGenerate().skills.quoted.description).toBe("Quoted text.");
  });

  test("counts every valid skill", () => {
    writeSkill("one", "name: one");
    writeSkill("two", "name: two");
    writeSkill("three", "name: three");

    expect(generateSkillIndex()).toBe(3);
  });
});

function readIndexAfterGenerate() {
  generateSkillIndex();
  return readIndex();
}

describe("generateSkillIndex — trigger extraction", () => {
  function triggersFor(description: string): string[] {
    writeSkill("probe", `name: probe\ndescription: ${description}`);
    generateSkillIndex();
    return readIndex().skills.probe.triggers;
  }

  test("pulls keywords out of a 'Use when' clause", () => {
    expect(triggersFor("Use when scheduling deployments.")).toContain("scheduling");
    expect(triggersFor("Use when scheduling deployments.")).toContain("deployments");
  });

  test("drops stopwords and short words from the clause", () => {
    const triggers = triggersFor("Use when the user wants that with your team.");

    for (const dropped of ["the", "that", "with", "your", "when"]) {
      expect(triggers).not.toContain(dropped);
    }
  });

  test("picks up domain terms from anywhere in the description", () => {
    const triggers = triggersFor("Handles security auditing and pdf output.");

    expect(triggers).toContain("security");
    expect(triggers).toContain("pdf");
  });

  test("does not repeat a term that appears twice", () => {
    const triggers = triggersFor("Use when research is needed. Deep research here.");

    expect(triggers.filter((t) => t === "research")).toHaveLength(1);
  });

  test("yields no triggers for a description with neither pattern", () => {
    expect(triggersFor("Nondescript helper.")).toEqual([]);
  });
});

describe("linkPersonalSkill", () => {
  test("throws when the skill is not in the PAL store", () => {
    expect(() => linkPersonalSkill("ghost")).toThrow("No skill found");
  });

  test("links only into agents whose skills directory exists", () => {
    writeSkill("mine", "name: mine");
    mkdirSync(resolve(AGENT_DIRS.PAL_CLAUDE_DIR, "skills"), { recursive: true });
    mkdirSync(resolve(AGENT_DIRS.PAL_CODEX_DIR, "skills"), { recursive: true });

    const linked = linkPersonalSkill("mine");

    expect(linked.sort()).toEqual(["claude", "codex"]);
    expect(existsSync(resolve(AGENT_DIRS.PAL_CURSOR_DIR, "skills", "mine"))).toBe(false);
  });

  test("creates a symlink rather than a copy", () => {
    writeSkill("mine", "name: mine");
    mkdirSync(resolve(AGENT_DIRS.PAL_CLAUDE_DIR, "skills"), { recursive: true });

    linkPersonalSkill("mine");

    const link = resolve(AGENT_DIRS.PAL_CLAUDE_DIR, "skills", "mine");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(resolve(link, "SKILL.md"))).toBe(true);
  });

  test("returns an empty list when no agent is installed", () => {
    writeSkill("mine", "name: mine");

    expect(linkPersonalSkill("mine")).toEqual([]);
  });

  test("is idempotent — re-linking leaves one symlink", () => {
    writeSkill("mine", "name: mine");
    mkdirSync(resolve(AGENT_DIRS.PAL_CLAUDE_DIR, "skills"), { recursive: true });

    linkPersonalSkill("mine");
    const second = linkPersonalSkill("mine");

    expect(second).toEqual(["claude"]);
    expect(
      lstatSync(resolve(AGENT_DIRS.PAL_CLAUDE_DIR, "skills", "mine")).isSymbolicLink()
    ).toBe(true);
  });
});
