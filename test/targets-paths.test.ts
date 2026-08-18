import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
// Imported at file load, before PAL_HOME is set below: these functions resolve
// their directories per call, so the env set in beforeEach still takes effect.
import {
  countAgents,
  countMd,
  countSkills,
  listPersonalSubagents,
} from "../src/targets/lib";

const HOME = resolve(import.meta.dir, "../.test-home-targets-paths");
const CLAUDE = resolve(HOME, ".claude");
const savedHome = process.env.PAL_HOME;
const savedClaude = process.env.PAL_CLAUDE_DIR;

function skill(name: string, withManifest = true) {
  mkdirSync(resolve(HOME, "skills", name), { recursive: true });
  if (withManifest) writeFileSync(resolve(HOME, "skills", name, "SKILL.md"), "x");
}

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  process.env.PAL_HOME = HOME;
  process.env.PAL_CLAUDE_DIR = CLAUDE;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  if (savedClaude === undefined) delete process.env.PAL_CLAUDE_DIR;
  else process.env.PAL_CLAUDE_DIR = savedClaude;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("countSkills", () => {
  test("counts only directories holding a SKILL.md", () => {
    skill("real-one");
    skill("also-real");
    skill("no-manifest", false);

    expect(countSkills()).toBe(2);
  });

  test("returns 0 when the skills directory is absent", () => {
    expect(countSkills()).toBe(0);
  });

  test("returns 0 for an empty skills directory", () => {
    mkdirSync(resolve(HOME, "skills"), { recursive: true });

    expect(countSkills()).toBe(0);
  });
});

describe("countMd", () => {
  test("counts only .md files", () => {
    const dir = resolve(HOME, "docs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "one.md"), "x");
    writeFileSync(resolve(dir, "two.md"), "x");
    writeFileSync(resolve(dir, "notes.txt"), "x");

    expect(countMd(dir)).toBe(2);
  });

  test("returns 0 for a missing directory", () => {
    expect(countMd(resolve(HOME, "nope"))).toBe(0);
  });
});

describe("countAgents", () => {
  test("counts .md files in the claude agents directory", () => {
    const dir = resolve(CLAUDE, "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "a.md"), "x");
    writeFileSync(resolve(dir, "b.md"), "x");
    writeFileSync(resolve(dir, "ignored.json"), "x");

    expect(countAgents()).toBe(2);
  });

  test("returns 0 when the agents directory is absent", () => {
    expect(countAgents()).toBe(0);
  });
});

describe("listPersonalSubagents", () => {
  test("lists agent names without the .md suffix", () => {
    mkdirSync(resolve(HOME, "agents"), { recursive: true });
    writeFileSync(resolve(HOME, "agents", "helper.md"), "x");
    writeFileSync(resolve(HOME, "agents", "other.md"), "x");
    writeFileSync(resolve(HOME, "agents", "README.txt"), "x");

    expect(listPersonalSubagents().sort()).toEqual(["helper", "other"]);
  });

  test("returns an empty list when the store is absent", () => {
    expect(listPersonalSubagents()).toEqual([]);
  });
});
