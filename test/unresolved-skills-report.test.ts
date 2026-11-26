import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { linkDir } from "./lib/links";
import { freshTestDir } from "./lib/test-home";
import { describeUnresolvedSkills } from "./lib/unresolved-skills-report";

const DIR = freshTestDir(import.meta.file);
const at = (...parts: string[]) => resolve(DIR, ...parts);

function buildSkillsFolder() {
  const real = at("real-skill");
  mkdirSync(real, { recursive: true });
  writeFileSync(resolve(real, "SKILL.md"), "# skill");
  const skills = at("skills");
  mkdirSync(skills, { recursive: true });
  linkDir(real, resolve(skills, "good"));
  linkDir(at("gone"), resolve(skills, "dangling"));

  return { skills, real };
}

describe("describeUnresolvedSkills", () => {
  const { skills, real } = buildSkillsFolder();
  const report = describeUnresolvedSkills(skills, ["good", "dangling", "missing"]);
  const lineFor = (name: string) =>
    report.split("\n").find((line) => line.includes(name)) ?? "";

  test("lists every unresolved name it is given", () => {
    expect(report).toContain("dangling");
    expect(report).toContain("missing");
  });

  test("says a dangling link is a symlink, names its target, and says the target does not exist", () => {
    const line = lineFor("dangling");
    expect(line).toMatch(/symlink/i);
    expect(line).toContain(at("gone"));
    expect(line).toMatch(/target[^\n]*(does not exist|missing|not exist)/i);
  });

  test("says a missing entry does not exist", () => {
    expect(lineFor("missing")).toMatch(/(does not exist|missing|not exist)/i);
  });

  test("says whether a link whose target exists is a symlink and that its target exists", () => {
    const line = lineFor("good");
    expect(line).toMatch(/symlink/i);
    expect(line).toContain(real);
    expect(line).toMatch(/target[^\n]*exists/i);
    expect(line).not.toMatch(/does not exist/i);
  });

  test("lists what the folder holds", () => {
    expect(report).toMatch(/good/);
    expect(report).toMatch(/dangling/);
    expect(report).toMatch(/holds|contains|entries/i);
  });

  test("still reports when the folder itself does not exist", () => {
    const text = describeUnresolvedSkills(at("nowhere"), ["x"]);
    expect(text).toContain("x");
    expect(text).toContain(at("nowhere"));
  });
});

function makeFolder(path: string) {
  mkdirSync(path, { recursive: true });

  return path;
}

function makeRealSkill(path: string) {
  makeFolder(path);
  writeFileSync(resolve(path, "SKILL.md"), "# skill");

  return path;
}

describe("describeUnresolvedSkills examples table", () => {
  const folder = (name: string) => at("table", name);

  test("row 1: a good link, a dangling link and a missing name", () => {
    const real = makeRealSkill(folder("row1-real"));
    const gone = folder("row1-gone");
    const dir = makeFolder(folder("row1"));
    linkDir(real, resolve(dir, "good"));
    linkDir(gone, resolve(dir, "dangling"));
    expect(describeUnresolvedSkills(dir, ["good", "dangling", "missing"])).toBe(
      [
        `good: symlink to ${real}, target exists`,
        `dangling: symlink to ${gone}, target does not exist`,
        "missing: does not exist",
        `${dir} holds: dangling, good`,
      ].join("\n")
    );
  });

  test("row 2: an absent folder", () => {
    const dir = folder("row2-nowhere");
    expect(describeUnresolvedSkills(dir, ["x"])).toBe(
      ["x: does not exist", `${dir} does not exist`].join("\n")
    );
  });

  test("row 3: an empty folder", () => {
    const dir = makeFolder(folder("row3"));
    expect(describeUnresolvedSkills(dir, ["a"])).toBe(
      ["a: does not exist", `${dir} holds nothing`].join("\n")
    );
  });

  test("row 4: a plain folder without a SKILL.md", () => {
    const dir = makeFolder(folder("row4"));
    makeFolder(resolve(dir, "plain"));
    expect(describeUnresolvedSkills(dir, ["plain"])).toBe(
      ["plain: exists, not a symlink", `${dir} holds: plain`].join("\n")
    );
  });

  test("row 5: a relative link, resolved against the folder", () => {
    const base = folder("row5");
    const real = makeRealSkill(resolve(base, "R"));
    const dir = makeFolder(resolve(base, "D"));
    linkDir("../R", resolve(dir, "rel"));
    expect(describeUnresolvedSkills(dir, ["rel"])).toBe(
      [`rel: symlink to ${real}, target exists`, `${dir} holds: rel`].join("\n")
    );
  });

  test("row 6: an empty names list prints only the folder line", () => {
    const dir = makeFolder(folder("row6"));
    makeFolder(resolve(dir, "a"));
    makeFolder(resolve(dir, "b"));
    expect(describeUnresolvedSkills(dir, [])).toBe(`${dir} holds: a, b`);
  });
});
