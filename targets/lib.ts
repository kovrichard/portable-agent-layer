/**
 * Shared utilities for PAI installers.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, mkdirSync, unlinkSync } from "fs";
import { resolve, basename } from "path";

// --- Colored logging ---

export const log = {
  info:    (msg: string) => console.log(`\x1b[34m[pai]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[pai]\x1b[0m ${msg}`),
  warn:    (msg: string) => console.log(`\x1b[33m[pai]\x1b[0m ${msg}`),
  error:   (msg: string) => console.error(`\x1b[31m[pai]\x1b[0m ${msg}`),
};

// --- JSON helpers ---

export function readJson<T = Record<string, unknown>>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// --- TELOS scaffolding ---

/** Copy template files into telos/ without overwriting existing ones */
export function scaffoldTelos(paiDir: string): void {
  const templatesDir = resolve(paiDir, "telos", "templates");
  const telosDir = resolve(paiDir, "telos");
  if (!existsSync(templatesDir)) return;

  for (const file of readdirSync(templatesDir).filter((f) => f.endsWith(".md"))) {
    const src = resolve(templatesDir, file);
    const dst = resolve(telosDir, file);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      log.info(`Created ${file} from template`);
    }
  }
}

// --- Skills ---

/** Copy skills additively (no overwrite) into a target skills dir */
export function copySkills(paiDir: string, targetSkillsDir: string): number {
  const skillsDir = resolve(paiDir, "skills");
  if (!existsSync(skillsDir)) return 0;

  mkdirSync(targetSkillsDir, { recursive: true });
  let count = 0;

  for (const file of readdirSync(skillsDir).filter((f) => f.endsWith(".md"))) {
    const src = resolve(skillsDir, file);
    const dst = resolve(targetSkillsDir, file);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      log.info(`Added skill: ${file}`);
      count++;
    } else {
      log.warn(`Skill exists, skipping: ${file}`);
    }
  }
  return count;
}

/** Remove PAI skills from a target skills dir */
export function removeSkills(paiDir: string, targetSkillsDir: string): string[] {
  const skillsDir = resolve(paiDir, "skills");
  if (!existsSync(skillsDir) || !existsSync(targetSkillsDir)) return [];

  const removed: string[] = [];
  for (const file of readdirSync(skillsDir).filter((f) => f.endsWith(".md"))) {
    const dst = resolve(targetSkillsDir, file);
    if (existsSync(dst)) {
      unlinkSync(dst);
      removed.push(file);
      log.info(`Removed skill: ${file}`);
    }
  }
  return removed;
}

/** Count .md files in a directory */
export function countMd(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/** Read skill frontmatter field */
export function readSkillField(skillPath: string, field: string): string {
  try {
    const content = readFileSync(skillPath, "utf-8");
    const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
    return match?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Strip frontmatter from a skill file (content after second ---) */
export function skillBody(skillPath: string): string {
  const content = readFileSync(skillPath, "utf-8");
  const parts = content.split(/^---\s*$/m);
  return parts.length >= 3 ? parts.slice(2).join("---").trim() : content.trim();
}
