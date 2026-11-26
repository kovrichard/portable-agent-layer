import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adminCommandNames } from "../src/cli/tree";
import { palPkg } from "../src/core/paths";
import {
  extractEnvVars,
  missingEnvVarSources,
  shippedSkillNames,
  validateReadmeSync as validateAgainst,
  WATCHED_PATHS,
} from "../src/core/readme-sync";
import { freshTestDir } from "./lib/test-home";

const ENV_VAR_SOURCE_FILES = [
  "src/core/paths.ts",
  "src/inference/inference.ts",
  "src/cli/doctor/inference.ts",
];

function packageWithOnlyAReadme(): string {
  const pkg = freshTestDir(import.meta.path);
  writeFileSync(resolve(pkg, "README.md"), "# PAL\n");

  return pkg;
}

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
  test("finds the folder overrides that paths.ts names", () => {
    const names = extractEnvVars();
    expect(names).toContain("PAL_HOME");
    expect(names).toContain("PAL_PKG");
    expect(names).toContain("PAL_CLAUDE_DIR");
    expect(names).toContain("PAL_AGENTS_DIR");
  });

  test("finds the API key the inference dispatcher reads", () => {
    expect(extractEnvVars()).toContain("PAL_ANTHROPIC_API_KEY");
  });

  test("finds the credentials the doctor knows about", () => {
    const names = extractEnvVars();
    expect(names).toContain("PAL_OPENAI_API_KEY");
    expect(names).toContain("PAL_GEMINI_API_KEY");
    expect(names).toContain("PAL_FYZZ_BASE_URL");
  });

  test("leaves out the markers PAL sets for its own subprocesses", () => {
    const names = extractEnvVars();
    expect(names).not.toContain("PAL_SPAWNED_INFERENCE");
    expect(names).not.toContain("PAL_INFERENCE_DEPTH");
  });

  test("names each variable once", () => {
    const names = extractEnvVars();
    expect(names.length).toBeGreaterThan(10);
    expect(new Set(names).size).toBe(names.length);
  });

  test("finds nothing in a package without the source files", () => {
    expect(extractEnvVars(packageWithOnlyAReadme())).toEqual([]);
  });
});

describe("a source file the check reads has gone", () => {
  test("no source is missing in this package", () => {
    expect(missingEnvVarSources()).toEqual([]);
  });

  test("every missing source is named", () => {
    expect(missingEnvVarSources(packageWithOnlyAReadme())).toEqual(ENV_VAR_SOURCE_FILES);
  });

  test("the README check fails and says which file it could not read", () => {
    const result = validateAgainst([], packageWithOnlyAReadme());
    const unreadable = result.issues.filter((i) => i.includes("cannot be checked"));
    expect(result.ok).toBe(false);
    expect(unreadable).toEqual(
      ENV_VAR_SOURCE_FILES.map(
        (file) => `Environment variables cannot be checked: ${file} is missing`
      )
    );
  });
});

describe("watched paths", () => {
  test("every watched path names a file or folder in the package", () => {
    const missing = WATCHED_PATHS.filter(
      (watched) => watched === "" || !existsSync(resolve(palPkg(), watched))
    );
    expect(missing).toEqual([]);
  });

  test("a change to a file the env var check reads triggers the README check", () => {
    for (const file of ENV_VAR_SOURCE_FILES) expect(WATCHED_PATHS).toContain(file);
  });

  test("a change to the CLI, a skill or an agent triggers the README check", () => {
    expect(WATCHED_PATHS).toContain("src/cli");
    expect(WATCHED_PATHS).toContain("assets/skills");
    expect(WATCHED_PATHS).toContain("assets/agents");
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
