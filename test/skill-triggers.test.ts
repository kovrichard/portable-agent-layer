import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { declaredTriggers } from "../src/hooks/lib/skill-triggers";

describe("declaredTriggers", () => {
  test("reads a YAML block sequence under metadata", () => {
    expect(
      declaredTriggers(
        'name: probe\nmetadata:\n  triggers:\n    - "make a deck"\n    - slides'
      )
    ).toEqual(["make a deck", "slides"]);
  });

  test("reads an inline sequence under metadata", () => {
    expect(declaredTriggers('metadata:\n  triggers: ["make a deck", "slides"]')).toEqual([
      "make a deck",
      "slides",
    ]);
  });

  test("reads an unquoted inline sequence", () => {
    expect(declaredTriggers("metadata:\n  triggers: [slides, decks]")).toEqual([
      "slides",
      "decks",
    ]);
  });

  test("lowercases and collapses whitespace in a declared trigger", () => {
    expect(declaredTriggers('metadata:\n  triggers:\n    - "Make   A Deck"')).toEqual([
      "make a deck",
    ]);
  });

  test("drops duplicates that differ only by case", () => {
    expect(
      declaredTriggers("metadata:\n  triggers:\n    - slides\n    - Slides")
    ).toEqual(["slides"]);
  });

  test("ignores a triggers key outside the metadata map", () => {
    expect(declaredTriggers('name: probe\ntriggers:\n  - "make a deck"')).toEqual([]);
  });

  test("stops the metadata block at the next top-level key", () => {
    expect(
      declaredTriggers(
        'metadata:\n  owner: docs\nargument-hint: <x>\n  triggers:\n    - "make a deck"'
      )
    ).toEqual([]);
  });

  test("stops the sequence at the next key inside metadata", () => {
    expect(
      declaredTriggers('metadata:\n  triggers:\n    - "make a deck"\n  owner: docs')
    ).toEqual(["make a deck"]);
  });

  test("yields nothing when there is no metadata map", () => {
    expect(declaredTriggers("name: probe\ndescription: Use when researching.")).toEqual(
      []
    );
  });
});

const HOME = resolve(import.meta.dir, "../.test-home-skill-triggers");
let savedHome: string | undefined;

function writeSkill(name: string, frontmatter: string) {
  const dir = resolve(HOME, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "SKILL.md"), `---\n${frontmatter}\n---\nbody`);
}

// src/targets/lib resolves the skills dir once at import time, so the module has
// to be re-evaluated after PAL_HOME is pointed at this test's sandbox — a plain
// import would hand back whatever home an earlier test file froze in.
async function generateIndex() {
  const { generateSkillIndex } = await import(`../src/targets/lib.ts?t=${Date.now()}`);
  return generateSkillIndex();
}

async function triggersFor(frontmatter: string): Promise<string[]> {
  writeSkill("probe", frontmatter);
  await generateIndex();
  const index = JSON.parse(
    readFileSync(resolve(HOME, "memory", "state", "skill-index.json"), "utf-8")
  );
  return index.skills.probe.triggers;
}

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  savedHome = process.env.PAL_HOME;
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("generateSkillIndex — trigger source", () => {
  test("publishes the declared triggers", async () => {
    expect(
      await triggersFor(
        'name: probe\ndescription: "A thing."\nmetadata:\n  triggers:\n    - "make a deck"'
      )
    ).toEqual(["make a deck"]);
  });

  test("declared triggers replace the ones derived from the description", async () => {
    const triggers = await triggersFor(
      'name: probe\ndescription: "Use when researching a topic."\nmetadata:\n  triggers:\n    - "make a deck"'
    );

    expect(triggers).toEqual(["make a deck"]);
    expect(triggers).not.toContain("researching");
  });

  test("falls back to derived triggers when metadata declares none", async () => {
    expect(
      await triggersFor('name: probe\ndescription: "Use when researching a topic."')
    ).toContain("researching");
  });
});
