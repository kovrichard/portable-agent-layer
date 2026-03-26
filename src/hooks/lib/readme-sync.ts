/**
 * README sync validation — ensures README.md reflects current code surfaces.
 *
 * Checks CLI commands, environment variables, and skills against README content.
 * Used by tests (CI/pre-commit) and the Stop hook (blocks session if stale).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palPkg } from "./paths";

export interface SyncResult {
  ok: boolean;
  issues: string[];
}

/** Files that, when changed, should trigger a README check. */
export const WATCHED_PATHS = [
  "src/cli/index.ts",
  "src/hooks/lib/paths.ts",
  "src/hooks/lib/inference.ts",
  "src/tools/youtube-analyze.ts",
  "assets/skills",
  "assets/agents",
];

/** Extract CLI command names from the switch statement in index.ts */
function extractCliCommands(): string[] {
  const pkg = palPkg();
  const cliPath = resolve(pkg, "src", "cli", "index.ts");
  if (!existsSync(cliPath)) return [];

  const content = readFileSync(cliPath, "utf-8");
  const matches = content.matchAll(/case\s+"([^"]+)":/g);
  const commands: string[] = [];

  for (const match of matches) {
    const cmd = match[1];
    // Skip help aliases and internal routing
    if (["--help", "-h", "help", "cli"].includes(cmd)) continue;
    commands.push(cmd);
  }

  return [...new Set(commands)];
}

/** Extract PAL_* env var names from paths.ts + API keys from source */
function extractEnvVars(): string[] {
  const pkg = palPkg();
  const vars: Set<string> = new Set();

  // PAL_* from paths.ts
  const pathsFile = resolve(pkg, "src", "hooks", "lib", "paths.ts");
  if (existsSync(pathsFile)) {
    const content = readFileSync(pathsFile, "utf-8");
    for (const match of content.matchAll(/process\.env\.(PAL_\w+)/g)) {
      vars.add(match[1]);
    }
  }

  // ANTHROPIC_API_KEY from inference.ts
  const inferenceFile = resolve(pkg, "src", "hooks", "lib", "inference.ts");
  if (existsSync(inferenceFile)) {
    const content = readFileSync(inferenceFile, "utf-8");
    if (content.includes("ANTHROPIC_API_KEY")) {
      vars.add("ANTHROPIC_API_KEY");
    }
  }

  // PAL_GEMINI_API_KEY from youtube-analyze.ts
  const youtubeFile = resolve(pkg, "src", "tools", "youtube-analyze.ts");
  if (existsSync(youtubeFile)) {
    const content = readFileSync(youtubeFile, "utf-8");
    if (content.includes("PAL_GEMINI_API_KEY")) {
      vars.add("PAL_GEMINI_API_KEY");
    }
  }

  return [...vars];
}

/** Extract skill names from assets/skills/ */
function extractSkillNames(): string[] {
  const pkg = palPkg();
  const skillsDir = resolve(pkg, "assets", "skills");
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

/** Validate that README.md documents all code surfaces. */
export function validateReadmeSync(): SyncResult {
  const pkg = palPkg();
  const readmePath = resolve(pkg, "README.md");

  if (!existsSync(readmePath)) {
    return { ok: false, issues: ["README.md not found"] };
  }

  const readme = readFileSync(readmePath, "utf-8");
  const issues: string[] = [];

  // Check CLI commands
  for (const cmd of extractCliCommands()) {
    if (!readme.includes(`pal cli ${cmd}`)) {
      issues.push(`CLI command "${cmd}" exists in code but not documented in README`);
    }
  }

  // Check environment variables
  for (const envVar of extractEnvVars()) {
    if (!readme.includes(envVar)) {
      issues.push(
        `Environment variable "${envVar}" used in code but not documented in README`
      );
    }
  }

  // Check skills — just verify the count is mentioned or each name appears
  const skills = extractSkillNames();
  const undocumentedSkills = skills.filter((name) => !readme.includes(name));
  if (undocumentedSkills.length > 0) {
    issues.push(`Skills not documented in README: ${undocumentedSkills.join(", ")}`);
  }

  return { ok: issues.length === 0, issues };
}
