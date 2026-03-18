/**
 * Shared utilities for PAI installers.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, mkdirSync, unlinkSync, symlinkSync, lstatSync, rmSync } from "fs";
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

const AGENTS_SKILLS_DIR = resolve(process.env.PAI_AGENTS_DIR!, "skills");

/**
 * Install PAI skills into the shared ~/.agents/skills/<name>/SKILL.md standard,
 * then symlink ~/.claude/skills/<name> → ../../.agents/skills/<name>.
 * Additive — skips skills already installed.
 */
export function copySkills(paiDir: string, claudeSkillsDir: string): number {
  const skillsDir = resolve(paiDir, "skills");
  if (!existsSync(skillsDir)) return 0;

  mkdirSync(AGENTS_SKILLS_DIR, { recursive: true });
  mkdirSync(claudeSkillsDir, { recursive: true });
  let count = 0;

  for (const file of readdirSync(skillsDir).filter((f) => f.endsWith(".md"))) {
    const name = file.replace(/\.md$/, "");
    const src = resolve(skillsDir, file);
    const agentSkillDir = resolve(AGENTS_SKILLS_DIR, name);
    const agentSkillFile = resolve(agentSkillDir, "SKILL.md");
    const claudeLink = resolve(claudeSkillsDir, name);

    // Install into ~/.agents/skills/<name>/SKILL.md
    if (!existsSync(agentSkillFile)) {
      mkdirSync(agentSkillDir, { recursive: true });
      copyFileSync(src, agentSkillFile);
      log.info(`Added skill: ${name}`);
      count++;
    } else {
      log.warn(`Skill exists, skipping: ${name}`);
    }

    // Create ~/.claude/skills/<name> symlink if missing or not a symlink
    try {
      const st = lstatSync(claudeLink);
      if (!st.isSymbolicLink()) {
        unlinkSync(claudeLink); // was a flat file — replace with symlink
        symlinkSync(`../../.agents/skills/${name}`, claudeLink);
      }
    } catch {
      symlinkSync(`../../.agents/skills/${name}`, claudeLink);
    }
  }
  return count;
}

/** Remove PAI skills from ~/.agents/skills/ and their symlinks from ~/.claude/skills/ */
export function removeSkills(paiDir: string, claudeSkillsDir: string): string[] {
  const skillsDir = resolve(paiDir, "skills");
  if (!existsSync(skillsDir)) return [];

  const removed: string[] = [];
  for (const file of readdirSync(skillsDir).filter((f) => f.endsWith(".md"))) {
    const name = file.replace(/\.md$/, "");

    const agentSkillDir = resolve(AGENTS_SKILLS_DIR, name);
    if (existsSync(agentSkillDir)) {
      rmSync(agentSkillDir, { recursive: true });
      removed.push(name);
      log.info(`Removed skill: ${name}`);
    }

    const claudeLink = resolve(claudeSkillsDir, name);
    try { unlinkSync(claudeLink); } catch { /* already gone */ }
  }
  return removed;
}

/** Count skill subdirectories in ~/.agents/skills/ */
export function countSkills(): number {
  if (!existsSync(AGENTS_SKILLS_DIR)) return 0;
  try {
    return readdirSync(AGENTS_SKILLS_DIR).filter((f) =>
      existsSync(resolve(AGENTS_SKILLS_DIR, f, "SKILL.md"))
    ).length;
  } catch {
    return 0;
  }
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
