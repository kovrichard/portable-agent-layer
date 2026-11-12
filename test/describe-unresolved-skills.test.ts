import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { linkDir } from "./lib/links";
import { freshTestDir } from "./lib/test-home";
import { describeUnresolvedSkills } from "./lib/unresolved-skills-report";

const DIR = freshTestDir(import.meta.file);
const at = (...parts: string[]) => resolve(DIR, ...parts);

function makeFolder(path: string) {
  mkdirSync(path, { recursive: true });

  return path;
}

function makeRealSkill(path: string) {
  makeFolder(path);
  writeFileSync(resolve(path, "SKILL.md"), "# skill");

  return path;
}

describe("describeUnresolvedSkills example table", () => {
  test("row 1: a good link, a dangling link and a missing name", () => {
    const real = makeRealSkill(at("row1-real"));
    const gone = at("row1-gone");
    const dir = makeFolder(at("row1"));
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
    const dir = at("row2-nowhere");
    expect(describeUnresolvedSkills(dir, ["x"])).toBe(
      ["x: does not exist", `${dir} does not exist`].join("\n")
    );
  });

  test("row 3: an empty folder", () => {
    const dir = makeFolder(at("row3"));
    expect(describeUnresolvedSkills(dir, ["a"])).toBe(
      ["a: does not exist", `${dir} holds nothing`].join("\n")
    );
  });

  test("row 4: a plain folder without a SKILL.md", () => {
    const dir = makeFolder(at("row4"));
    makeFolder(resolve(dir, "plain"));
    expect(describeUnresolvedSkills(dir, ["plain"])).toBe(
      ["plain: exists, not a symlink", `${dir} holds: plain`].join("\n")
    );
  });

  test("row 5: a relative link, resolved against the folder", () => {
    const base = at("row5");
    const real = makeRealSkill(resolve(base, "R"));
    const dir = makeFolder(resolve(base, "D"));
    linkDir("../R", resolve(dir, "rel"));
    expect(describeUnresolvedSkills(dir, ["rel"])).toBe(
      [`rel: symlink to ${real}, target exists`, `${dir} holds: rel`].join("\n")
    );
  });

  test("row 6: an empty names list prints only the folder line", () => {
    const dir = makeFolder(at("row6"));
    makeFolder(resolve(dir, "a"));
    makeFolder(resolve(dir, "b"));
    expect(describeUnresolvedSkills(dir, [])).toBe(`${dir} holds: a, b`);
  });
});
