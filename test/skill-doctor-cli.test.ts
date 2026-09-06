import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const ROOT = resolve(import.meta.dir, "../.test-home-skill-doctor-cli");
const PAL = resolve(ROOT, ".pal");

const GOOD = `---
name: good-skill
description: "Summarizes a thing into a report. Use when the user asks to summarize a thing."
metadata:
  triggers:
    - "good-skill"
    - "good skill"
    - "summarize a thing"
---

# Good skill

1. Read the input.
2. Produce the output.
`;

function installSkill(name: string, skillMd: string) {
  const dir = resolve(PAL, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "SKILL.md"), skillMd);
}

beforeAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
  installSkill(
    "clean-skill",
    GOOD.replaceAll("good-skill", "clean-skill").replaceAll("good skill", "clean skill")
  );
  installSkill("Broken", GOOD.replace("good-skill", "UPPER"));
});

afterAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true });
});

describe("pal cli skill doctor", () => {
  function doctor(name: string, home = PAL) {
    return spawnSync("bun", ["run", CLI, "cli", "skill", "doctor", name], {
      env: { ...process.env, PAL_HOME: home },
      encoding: "utf-8",
      timeout: 15000,
    });
  }

  test("exits 0 for a clean skill", () => {
    const r = doctor("clean-skill");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PASS");
  });

  test("exits 1 when a skill has errors", () => {
    expect(doctor("Broken").status).toBe(1);
  });

  test("--all reports every installed skill", () => {
    const r = doctor("--all");

    expect(r.stdout).toContain("clean-skill");
    expect(r.stdout).toContain("Broken");
    expect(r.stdout).toContain("2 skills");
  });

  test("--all exits 1 when any skill has errors", () => {
    expect(doctor("--all").status).toBe(1);
  });

  test("--all exits 0 and says so when there are no skills", () => {
    const emptyHome = resolve(ROOT, "empty-home");
    mkdirSync(resolve(emptyHome, "skills"), { recursive: true });
    const r = doctor("--all", emptyHome);

    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("No skills found");
  });

  test("exits 1 with usage when no name is given", () => {
    const r = spawnSync("bun", ["run", CLI, "cli", "skill", "doctor"], {
      env: { ...process.env, PAL_HOME: PAL },
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(r.status).toBe(1);
  });
});
