import { describe, expect, test } from "bun:test";
import { shippedSkillNames, validateReadmeSync } from "../src/hooks/lib/readme-sync";

describe("README sync", () => {
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
