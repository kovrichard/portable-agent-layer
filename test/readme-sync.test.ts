import { describe, expect, test } from "bun:test";
import { validateReadmeSync } from "../src/hooks/lib/readme-sync";

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
