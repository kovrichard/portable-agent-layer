import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Glob } from "bun";

const REPO = resolve(import.meta.dir, "..");
const SKILL_ROOTS = ["assets/skills", ".agents/skills"];
const SCALAR_KEYS = ["name", "description", "argument-hint"];

function skillFiles(): string[] {
  return SKILL_ROOTS.flatMap((root) =>
    Array.from(new Glob("**/SKILL.md").scanSync({ cwd: resolve(REPO, root) })).map(
      (rel) => resolve(REPO, root, rel)
    )
  );
}

function frontmatterLines(path: string): string[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf-8"));
  return match ? match[1].split(/\r?\n/) : [];
}

function topLevelScalars(path: string): { key: string; raw: string }[] {
  return frontmatterLines(path)
    .map((line) => /^([a-z][a-z-]*):[ \t]*(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .filter(([, key]) => SCALAR_KEYS.includes(key))
    .map(([, key, raw]) => ({ key, raw: raw.trim() }));
}

/**
 * A YAML value opening with "[" or "{" is a flow collection, not text, so
 * Copilot rejects the skill: "argument hint must be a string".
 */
function isFlowCollection(raw: string): boolean {
  return raw.startsWith("[") || raw.startsWith("{");
}

const skills = skillFiles().map((path) => ({
  path: relative(REPO, path),
  scalars: topLevelScalars(path),
}));

describe("every shipped skill's frontmatter", () => {
  test("finds skills to check, so a glob typo cannot pass this file", () => {
    expect(skills.length).toBeGreaterThan(10);
  });

  test("carries the scalar keys it is checking", () => {
    const named = skills.filter((s) => s.scalars.some((x) => x.key === "name"));
    expect(named.length).toBe(skills.length);
  });

  test("gives every scalar key a string, never a list or map", () => {
    for (const { path, scalars } of skills) {
      for (const { key, raw } of scalars) {
        const shape = isFlowCollection(raw) ? "collection" : "string";
        expect(`${path} ${key}: ${shape}`).toBe(`${path} ${key}: string`);
      }
    }
  });
});
