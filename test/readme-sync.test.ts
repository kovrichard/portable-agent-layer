import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { adminCommandNames } from "../src/cli/tree";
import { palPkg } from "../src/core/paths";
import {
  extractEnvVars,
  shippedSkillNames,
  validateReadmeSync as validateAgainst,
  WATCHED_PATHS,
} from "../src/core/readme-sync";

const validateReadmeSync = () => validateAgainst(adminCommandNames());

describe("README sync", () => {
  test("checks the CLI's own commands, not the built-in tool verbs", () => {
    const names = adminCommandNames();
    expect(names).toContain("install");
    expect(names).toContain("knowledge");
    expect(names).not.toContain("thread");
  });

  test("flags a command the README does not document", () => {
    expect(validateAgainst(["frobnicate"]).issues).toContain(
      'CLI command "frobnicate" exists in code but not documented in README'
    );
  });

  test("README documents all CLI commands", () => {
    const result = validateReadmeSync();
    const cmdIssues = result.issues.filter((i) => i.includes("CLI command"));
    expect(cmdIssues).toEqual([]);
  });

  test("README documents all environment variables", () => {
    const result = validateReadmeSync();
    const envIssues = result.issues.filter((i) => i.includes("Environment variable"));
    expect(envIssues).toEqual([]);
  });

  test("README documents all skills", () => {
    const result = validateReadmeSync();
    const skillIssues = result.issues.filter((i) => i.includes("Skills not documented"));
    expect(skillIssues).toEqual([]);
  });

  test("full validation passes", () => {
    const result = validateReadmeSync();
    if (!result.ok) {
      throw new Error(
        `README out of sync:\n${result.issues.map((i) => `  - ${i}`).join("\n")}`
      );
    }

    expect(result.ok).toBe(true);
  });
});

describe("environment variable extraction", () => {
  test("finds the API key the inference dispatcher reads", () => {
    expect(extractEnvVars()).toContain("PAL_ANTHROPIC_API_KEY");
  });
});

describe("watched paths", () => {
  test("a change to the inference dispatcher triggers the README check", () => {
    const dispatcher = "src/inference/inference.ts";
    expect(existsSync(resolve(palPkg(), dispatcher))).toBe(true);
    expect(WATCHED_PATHS).toContain(dispatcher);
  });
});

describe("skill extraction", () => {
  test("finds the shipped skills", () => {
    // Skills are directories holding a SKILL.md, not loose .md files. An empty
    // list here means the skills check passes vacuously and never sees drift.
    expect(shippedSkillNames().length).toBeGreaterThan(10);
    expect(shippedSkillNames()).toContain("humanize");
  });

  test("flags a README row naming a skill that no longer ships", () => {
    const issues = validateReadmeSync().issues.filter((i) => i.includes("no longer"));
    expect(issues).toEqual([]);
  });
});
