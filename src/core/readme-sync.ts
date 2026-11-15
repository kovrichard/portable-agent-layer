/**
 * README sync validation — ensures README.md reflects current code surfaces.
 *
 * Checks CLI commands, environment variables, and skills against README content.
 * Used by tests (CI/pre-commit) and the Stop hook (blocks session if stale).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palPkg } from "./paths";

interface SyncResult {
  ok: boolean;
  issues: string[];
}

interface EnvVarSource {
  file: string;
  names: RegExp;
}

const ENV_VAR_SOURCES: EnvVarSource[] = [
  { file: "src/core/paths.ts", names: /\bPAL_[A-Z0-9_]+\b/g },
  { file: "src/inference/inference.ts", names: /\bPAL_[A-Z0-9_]+_API_KEY\b/g },
  {
    file: "src/cli/doctor/inference.ts",
    names: /\bPAL_[A-Z0-9_]+_(?:API_KEY|BASE_URL)\b/g,
  },
];

/** Files that, when changed, should trigger a README check. */
export const WATCHED_PATHS = [
  "src/cli",
  ...ENV_VAR_SOURCES.map((source) => source.file),
  "assets/skills",
  "assets/agents",
];

export function missingEnvVarSources(pkg: string = palPkg()): string[] {
  return ENV_VAR_SOURCES.map((source) => source.file).filter(
    (file) => !existsSync(resolve(pkg, file))
  );
}

function namesIn(source: EnvVarSource, pkg: string): string[] {
  const path = resolve(pkg, source.file);
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf-8").match(source.names) ?? [];
}

export function extractEnvVars(pkg: string = palPkg()): string[] {
  return [...new Set(ENV_VAR_SOURCES.flatMap((source) => namesIn(source, pkg)))];
}

/**
 * Names of the skills PAL ships — one directory per skill, each holding a
 * SKILL.md. Reading the directory rather than loose `.md` files matters: the
 * folder-per-skill layout is what the runtime loads, and matching on files
 * silently yields nothing, which makes every skill check pass vacuously.
 */
export function shippedSkillNames(): string[] {
  const skillsDir = resolve(palPkg(), "assets", "skills");
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(resolve(skillsDir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

/**
 * Skill names the README's "## Skills" table claims PAL ships. Scoped to that
 * one section: other tables list commands and agents in the same row shape, and
 * matching them would report every command as a retired skill.
 */
function documentedSkillNames(readme: string): string[] {
  const section = /^## Skills$([\s\S]*?)(?=^## )/m.exec(readme)?.[1] ?? "";

  return Array.from(section.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm), (m) => m[1]);
}

/** Validate that README.md documents all code surfaces. */
export function validateReadmeSync(
  cliCommands: string[],
  pkg: string = palPkg()
): SyncResult {
  const readmePath = resolve(pkg, "README.md");

  if (!existsSync(readmePath)) {
    return { ok: false, issues: ["README.md not found"] };
  }

  const readme = readFileSync(readmePath, "utf-8");
  const issues: string[] = [];

  for (const cmd of cliCommands) {
    if (!readme.includes(`pal cli ${cmd}`)) {
      issues.push(`CLI command "${cmd}" exists in code but not documented in README`);
    }
  }

  for (const file of missingEnvVarSources(pkg)) {
    issues.push(`Environment variables cannot be checked: ${file} is missing`);
  }

  for (const envVar of extractEnvVars(pkg)) {
    if (!readme.includes(envVar)) {
      issues.push(
        `Environment variable "${envVar}" used in code but not documented in README`
      );
    }
  }

  // Check skills — every shipped skill has a row, and no row outlives its skill
  const shipped = shippedSkillNames();
  const undocumentedSkills = shipped.filter((name) => !readme.includes(name));
  if (undocumentedSkills.length > 0) {
    issues.push(`Skills not documented in README: ${undocumentedSkills.join(", ")}`);
  }

  const retired = documentedSkillNames(readme).filter((name) => !shipped.includes(name));
  if (retired.length > 0) {
    issues.push(`README documents skills that no longer ship: ${retired.join(", ")}`);
  }

  return { ok: issues.length === 0, issues };
}
