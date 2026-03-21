/**
 * Shared utilities for PAI installers.
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { assets, palHome } from "../hooks/lib/paths";

// --- Colored logging ---

export const log = {
  info: (msg: string) => console.log(`\x1b[34m[pai]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[pai]\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[pai]\x1b[0m ${msg}`),
  error: (msg: string) => console.error(`\x1b[31m[pai]\x1b[0m ${msg}`),
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
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

// --- TELOS scaffolding ---

/** Copy template files into telos/ without overwriting existing ones */
export function scaffoldTelos(): void {
  const templatesDir = assets.telosTemplates();
  const telosDir = resolve(palHome(), "telos");
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
export function copySkills(claudeSkillsDir: string): number {
  const skillsDir = assets.skills();
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
    // Use 'junction' on Windows (no admin required), 'dir' symlink on Unix
    const linkType = process.platform === "win32" ? "junction" : "dir";
    try {
      const st = lstatSync(claudeLink);
      if (!st.isSymbolicLink()) {
        rmSync(claudeLink, { recursive: true, force: true });
        symlinkSync(`../../.agents/skills/${name}`, claudeLink, linkType);
      }
    } catch {
      // Entry might exist but lstatSync failed (broken symlink/junction on Windows)
      try {
        rmSync(claudeLink, { recursive: true, force: true });
      } catch {
        /* gone */
      }
      symlinkSync(`../../.agents/skills/${name}`, claudeLink, linkType);
    }
  }
  return count;
}

/** Remove PAI skills from ~/.agents/skills/ and their symlinks from ~/.claude/skills/ */
export function removeSkills(claudeSkillsDir: string): string[] {
  const skillsDir = assets.skills();
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
    try {
      unlinkSync(claudeLink);
    } catch {
      /* already gone */
    }
  }
  return removed;
}

// --- Agents ---

const CLAUDE_AGENTS_DIR = resolve(process.env.PAI_CLAUDE_DIR!, "agents");

/**
 * Install PAI agent definitions into ~/.claude/agents/.
 * Additive — skips agents already installed.
 */
export function copyAgents(): number {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return 0;

  mkdirSync(CLAUDE_AGENTS_DIR, { recursive: true });
  let count = 0;

  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const src = resolve(agentsDir, file);
    const dst = resolve(CLAUDE_AGENTS_DIR, file);

    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      log.info(`Added agent: ${file.replace(/\.md$/, "")}`);
      count++;
    } else {
      log.warn(`Agent exists, skipping: ${file.replace(/\.md$/, "")}`);
    }
  }
  return count;
}

/** Remove PAI agents from ~/.claude/agents/ */
export function removeAgents(): string[] {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return [];

  const removed: string[] = [];
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const dst = resolve(CLAUDE_AGENTS_DIR, file);
    if (existsSync(dst)) {
      unlinkSync(dst);
      const name = file.replace(/\.md$/, "");
      removed.push(name);
      log.info(`Removed agent: ${name}`);
    }
  }
  return removed;
}

/** Count agent .md files in ~/.claude/agents/ */
export function countAgents(): number {
  if (!existsSync(CLAUDE_AGENTS_DIR)) return 0;
  try {
    return readdirSync(CLAUDE_AGENTS_DIR).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

// --- Opencode agent translation ---

/** Map Claude Code tool names to opencode permission keys */
const TOOL_TO_PERMISSION: Record<string, string> = {
  WebSearch: "webfetch",
  WebFetch: "webfetch",
  Read: "read",
  Grep: "read",
  Glob: "read",
  Write: "edit",
  Edit: "edit",
  Bash: "bash",
};

/**
 * Translate a Claude Code agent .md file to opencode format.
 * - `tools: X, Y` → `permission: { x: allow, ... }`
 * - Adds `mode: subagent`
 * - Keeps everything else (name, description, model, body)
 */
export function translateAgentForOpencode(content: string): string {
  const parts = content.split(/^---\s*$/m);
  if (parts.length < 3) return content;

  const frontmatter = parts[1];
  const body = parts.slice(2).join("---");

  // Extract tools line
  const toolsMatch = frontmatter.match(/^tools:\s*(.+)$/m);
  const tools = toolsMatch ? toolsMatch[1].split(",").map((t) => t.trim()) : [];

  // Build opencode permissions (deduplicated)
  const perms = new Set<string>();
  for (const tool of tools) {
    const perm = TOOL_TO_PERMISSION[tool];
    if (perm) perms.add(perm);
  }

  // Build new frontmatter: remove tools line, add mode + permission
  let newFrontmatter = frontmatter.replace(/^tools:\s*.+$/m, "").trim();
  newFrontmatter += "\nmode: subagent";
  if (perms.size > 0) {
    const permObj = Object.fromEntries([...perms].map((p) => [p, "allow"]));
    // Inline YAML object
    const permYaml = Object.entries(permObj)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");
    newFrontmatter += `\npermission:\n${permYaml}`;
  }

  return `---\n${newFrontmatter}\n---\n${body}`;
}

/**
 * Install PAI agent definitions into an opencode agents directory.
 * Translates frontmatter from Claude Code format to opencode format.
 */
export function copyAgentsForOpencode(ocAgentsDir: string): number {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return 0;

  mkdirSync(ocAgentsDir, { recursive: true });
  let count = 0;

  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const dst = resolve(ocAgentsDir, file);
    if (!existsSync(dst)) {
      const src = resolve(agentsDir, file);
      const content = readFileSync(src, "utf-8");
      writeFileSync(dst, translateAgentForOpencode(content), "utf-8");
      log.info(`Added opencode agent: ${file.replace(/\.md$/, "")}`);
      count++;
    } else {
      log.warn(`Opencode agent exists, skipping: ${file.replace(/\.md$/, "")}`);
    }
  }
  return count;
}

/** Remove PAI agents from an opencode agents directory */
export function removeAgentsFromOpencode(ocAgentsDir: string): string[] {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return [];

  const removed: string[] = [];
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const dst = resolve(ocAgentsDir, file);
    if (existsSync(dst)) {
      unlinkSync(dst);
      const name = file.replace(/\.md$/, "");
      removed.push(name);
      log.info(`Removed opencode agent: ${name}`);
    }
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
