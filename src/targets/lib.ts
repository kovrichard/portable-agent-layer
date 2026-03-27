/**
 * Shared utilities for PAL installers.
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
import { assets, palHome, platform } from "../hooks/lib/paths";

// --- Colored logging ---

export const log = {
  info: (msg: string) => console.log(`\x1b[34m[pal]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[pal]\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[pal]\x1b[0m ${msg}`),
  error: (msg: string) => console.error(`\x1b[31m[pal]\x1b[0m ${msg}`),
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

// --- Settings template merge/unmerge ---

type HookEntry = { matcher?: string; hooks?: Array<{ type: string; command: string }> };
type Settings = Record<string, unknown> & {
  hooks?: Record<string, HookEntry[]>;
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
};

/**
 * Load a settings template, replacing {{PKG_ROOT}} with the actual path.
 */
export function loadSettingsTemplate(templatePath: string, pkgRoot: string): Settings {
  const raw = readFileSync(templatePath, "utf-8");
  const resolved = raw.replaceAll("{{PKG_ROOT}}", pkgRoot);
  return JSON.parse(resolved) as Settings;
}

/**
 * Merge a PAL settings template into existing settings.
 * - hooks: deduplicate by command string
 * - permissions.allow: deduplicate by value
 * - other keys: template values are added if not already present
 */
export function mergeSettings(existing: Settings, template: Settings): Settings {
  const result = { ...existing };

  // Merge hooks (deduplicate by command)
  if (template.hooks) {
    if (!result.hooks) result.hooks = {};
    for (const [event, entries] of Object.entries(template.hooks)) {
      const current = result.hooks[event] ?? [];
      for (const entry of entries) {
        const cmd = entry.hooks?.[0]?.command;
        if (cmd && !current.some((e) => e.hooks?.[0]?.command === cmd)) {
          current.push(entry);
        }
      }
      result.hooks[event] = current;
    }
  }

  // Merge permissions.allow (deduplicate)
  if (template.permissions?.allow) {
    if (!result.permissions) result.permissions = {};
    if (!result.permissions.allow) result.permissions.allow = [];
    for (const perm of template.permissions.allow) {
      if (!result.permissions.allow.includes(perm)) {
        result.permissions.allow.push(perm);
      }
    }
  }

  return result;
}

/**
 * Remove everything a PAL settings template added from existing settings.
 * - hooks: remove entries whose command matches any template command
 * - permissions.allow: remove entries that appear in the template
 * - cleans up empty arrays/objects
 */
export function unmergeSettings(existing: Settings, template: Settings): Settings {
  const result = { ...existing };

  // Collect all PAL hook commands from template
  if (template.hooks && result.hooks) {
    const palCommands = new Set<string>();
    for (const entries of Object.values(template.hooks)) {
      for (const entry of entries) {
        const cmd = entry.hooks?.[0]?.command;
        if (cmd) palCommands.add(cmd);
      }
    }

    for (const [event, entries] of Object.entries(result.hooks)) {
      result.hooks[event] = entries.filter((e) => {
        const cmd = e.hooks?.[0]?.command;
        return !cmd || !palCommands.has(cmd);
      });
      if (result.hooks[event].length === 0) delete result.hooks[event];
    }
    if (Object.keys(result.hooks).length === 0) delete result.hooks;
  }

  // Remove PAL permissions
  if (template.permissions?.allow && result.permissions?.allow) {
    const palPerms = new Set(template.permissions.allow);
    result.permissions.allow = result.permissions.allow.filter((p) => !palPerms.has(p));
    if (result.permissions.allow.length === 0) delete result.permissions.allow;
    if (Object.keys(result.permissions).length === 0) delete result.permissions;
  }

  return result;
}

// --- Cursor hooks.json merge/unmerge ---

type CursorHookEntry = {
  type: string;
  command: string;
  matcher?: string;
  timeout?: number;
};
type CursorHooks = {
  version?: number;
  hooks?: Record<string, CursorHookEntry[]>;
};

/**
 * Load a Cursor hooks template, replacing {{PKG_ROOT}} with the actual path.
 */
export function loadCursorHooksTemplate(
  templatePath: string,
  pkgRoot: string
): CursorHooks {
  const raw = readFileSync(templatePath, "utf-8");
  const resolved = raw.replaceAll("{{PKG_ROOT}}", pkgRoot);
  return JSON.parse(resolved) as CursorHooks;
}

/**
 * Merge PAL hooks into an existing Cursor hooks.json.
 * Deduplicates by command string within each event.
 */
export function mergeCursorHooks(
  existing: CursorHooks,
  template: CursorHooks
): CursorHooks {
  const result: CursorHooks = { ...existing, version: existing.version ?? 1 };

  if (template.hooks) {
    if (!result.hooks) result.hooks = {};
    for (const [event, entries] of Object.entries(template.hooks)) {
      const current = result.hooks[event] ?? [];
      for (const entry of entries) {
        if (!current.some((e) => e.command === entry.command)) {
          current.push(entry);
        }
      }
      result.hooks[event] = current;
    }
  }

  return result;
}

/**
 * Remove PAL hooks from an existing Cursor hooks.json.
 * Only removes entries whose command matches the template. Preserves user hooks.
 */
export function unmergeCursorHooks(
  existing: CursorHooks,
  template: CursorHooks
): CursorHooks {
  const result: CursorHooks = { ...existing };

  if (template.hooks && result.hooks) {
    const palCommands = new Set<string>();
    for (const entries of Object.values(template.hooks)) {
      for (const entry of entries) {
        palCommands.add(entry.command);
      }
    }

    for (const [event, entries] of Object.entries(result.hooks)) {
      result.hooks[event] = entries.filter((e) => !palCommands.has(e.command));
      if (result.hooks[event].length === 0) delete result.hooks[event];
    }
    if (Object.keys(result.hooks).length === 0) delete result.hooks;
  }

  return result;
}

// --- TELOS scaffolding ---

/** Copy template files into telos/ without overwriting existing ones */
export function scaffoldTelos(): void {
  const templatesDir = assets.telosTemplates();
  const telosDir = resolve(palHome(), "telos");
  if (!existsSync(templatesDir)) return;
  mkdirSync(telosDir, { recursive: true });

  for (const file of readdirSync(templatesDir).filter((f) => f.endsWith(".md"))) {
    const src = resolve(templatesDir, file);
    const dst = resolve(telosDir, file);
    if (!existsSync(dst)) {
      copyFileSync(src, dst);
      log.info(`Created ${file} from template`);
    }
  }
}

// --- PAL settings scaffolding ---

/** Copy pal-settings.json template to memory/ without overwriting */
export function scaffoldPalSettings(): void {
  const src = resolve(assets.skills(), "..", "templates", "pal-settings.json");
  if (!existsSync(src)) return;

  const memDir = resolve(palHome(), "memory");
  mkdirSync(memDir, { recursive: true });

  const dst = resolve(memDir, "pal-settings.json");
  if (!existsSync(dst)) {
    copyFileSync(src, dst);
    log.info("Created pal-settings.json from template");
  }
}

// --- PAL docs (modular context routing files) ---

const PAL_DOCS_DIR = resolve(palHome(), "docs");
const PAL_TOOLS_DIR = resolve(palHome(), "tools");

/**
 * Install PAL system docs into ~/.pal/docs/.
 * Always overwrites — these are engine-managed, not user-editable.
 * Also creates ~/.pal/tools/ → repo agent tools (symlink).
 */
export function copyPalDocs(): number {
  const srcDir = assets.palDocs();
  if (!existsSync(srcDir)) return 0;

  mkdirSync(PAL_DOCS_DIR, { recursive: true });
  let count = 0;

  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".md"))) {
    const src = resolve(srcDir, file);
    const dst = resolve(PAL_DOCS_DIR, file);
    copyFileSync(src, dst);
    count++;
  }

  // ~/.pal/tools/ → repo agent tools
  const linkType = process.platform === "win32" ? "junction" : "dir";
  ensureSymlink(PAL_TOOLS_DIR, assets.agentTools(), linkType);

  return count;
}

/** Remove PAL system docs from ~/.pal/docs/ */
export function removePalDocs(): void {
  // Remove tools symlink
  try {
    unlinkSync(PAL_TOOLS_DIR);
  } catch {
    /* gone */
  }
  if (!existsSync(PAL_DOCS_DIR)) return;
  try {
    rmSync(PAL_DOCS_DIR, { recursive: true });
    log.info("Removed ~/.pal/docs/");
  } catch {
    /* gone */
  }
}

// --- Skills ---

const PAL_SKILLS_DIR = resolve(palHome(), "skills");

/**
 * Install PAL skills by symlinking:
 *   ~/.pal/skills/<name> → <repo>/assets/skills/<name>  (source of truth)
 *   ~/.claude/skills/<name> → ~/.pal/skills/<name>       (agent discovery)
 *
 * Symlinks mean tools inside skills can import from the repo (src/hooks/lib/*)
 * and everything resolves naturally. Additive — skips skills already installed.
 */
export function copySkills(claudeSkillsDir: string): number {
  const skillsDir = assets.skills();
  if (!existsSync(skillsDir)) return 0;

  mkdirSync(PAL_SKILLS_DIR, { recursive: true });
  mkdirSync(claudeSkillsDir, { recursive: true });
  const linkType = process.platform === "win32" ? "junction" : "dir";
  let count = 0;

  for (const name of readdirSync(skillsDir)) {
    const srcDir = resolve(skillsDir, name);
    if (!existsSync(resolve(srcDir, "SKILL.md"))) continue;

    // ~/.pal/skills/<name> → <repo>/assets/skills/<name>
    const palLink = resolve(PAL_SKILLS_DIR, name);
    ensureSymlink(palLink, srcDir, linkType);

    // ~/.claude/skills/<name> → ~/.pal/skills/<name>
    const claudeLink = resolve(claudeSkillsDir, name);
    ensureSymlink(claudeLink, palLink, linkType);

    log.info(`Linked skill: ${name}`);
    count++;
  }

  // ~/.agents/skills/ → ~/.pal/skills/
  mkdirSync(platform.agentsDir(), { recursive: true });
  ensureSymlink(resolve(platform.agentsDir(), "skills"), PAL_SKILLS_DIR, linkType);

  return count;
}

/** Create or update a symlink/junction, replacing any non-symlink entry. */
function ensureSymlink(link: string, target: string, type: "dir" | "junction"): void {
  try {
    const st = lstatSync(link);
    if (st.isSymbolicLink()) return; // already a symlink, leave it
    rmSync(link, { recursive: true, force: true });
  } catch {
    // doesn't exist or broken — clean up just in case
    try {
      rmSync(link, { recursive: true, force: true });
    } catch {
      /* gone */
    }
  }
  symlinkSync(target, link, type);
}

/** Remove PAL skill symlinks from ~/.pal/skills/ and ~/.claude/skills/ */
export function removeSkills(claudeSkillsDir: string): string[] {
  const skillsDir = assets.skills();
  if (!existsSync(skillsDir)) return [];

  const removed: string[] = [];
  for (const name of readdirSync(skillsDir)) {
    if (!existsSync(resolve(skillsDir, name, "SKILL.md"))) continue;

    for (const link of [resolve(PAL_SKILLS_DIR, name), resolve(claudeSkillsDir, name)]) {
      try {
        unlinkSync(link);
      } catch {
        /* already gone */
      }
    }
    removed.push(name);
    log.info(`Removed skill: ${name}`);
  }

  // Remove ~/.agents/skills/ → ~/.pal/skills/ symlink
  try {
    unlinkSync(resolve(platform.agentsDir(), "skills"));
  } catch {
    /* gone */
  }

  return removed;
}

// --- Agents ---

const CLAUDE_AGENTS_DIR = resolve(platform.claudeDir(), "agents");

/**
 * Install PAL agent definitions into ~/.claude/agents/.
 * Always overwrites — engine-managed, not user-editable.
 */
export function copyAgents(): number {
  return installAgents(CLAUDE_AGENTS_DIR, "claude");
}

/** Remove PAL agents from ~/.claude/agents/ */
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

// --- Agent platform extraction ---

const AGENT_PLATFORMS = ["claude", "opencode", "cursor"] as const;
type AgentPlatform = (typeof AGENT_PLATFORMS)[number];

/**
 * Extract a platform-specific agent file from the unified agent format.
 *
 * Each agent .md defines platform blocks at the top level:
 *   claude:     → fields for Claude Code
 *   opencode:   → fields for opencode
 *   cursor:     → fields for Cursor
 *
 * Global fields (name, description) are always included.
 * The target platform block is un-indented and merged into the root.
 * All other platform blocks are stripped.
 */
export function extractAgentForPlatform(
  content: string,
  platform: AgentPlatform
): string {
  const parts = content.split(/^---\s*$/m);
  if (parts.length < 3) return content;

  const frontmatter = parts[1];
  const body = parts.slice(2).join("---");

  const globalLines: string[] = [];
  const platformLines: Record<AgentPlatform, string[]> = {
    claude: [],
    opencode: [],
    cursor: [],
  };
  let currentPlatform: AgentPlatform | null = null;

  for (const line of frontmatter.split("\n")) {
    if (!line.trim()) continue;

    const platformMatch = line.match(/^(claude|opencode|cursor):\s*$/);
    if (platformMatch) {
      currentPlatform = platformMatch[1] as AgentPlatform;
      continue;
    }

    if (currentPlatform) {
      if (line.match(/^ {2}/)) {
        platformLines[currentPlatform].push(line.slice(2)); // un-indent one level
        continue;
      }
      currentPlatform = null; // end of platform block
    }

    globalLines.push(line);
  }

  const newFrontmatter = [...globalLines, ...platformLines[platform]]
    .filter((l) => l.trim())
    .join("\n");

  return `---\n${newFrontmatter}\n---\n${body}`;
}

/** Install agents for a platform into a target directory. Always overwrites. */
function installAgents(targetDir: string, platform: AgentPlatform): number {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return 0;

  mkdirSync(targetDir, { recursive: true });
  let count = 0;

  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const content = readFileSync(resolve(agentsDir, file), "utf-8");
    writeFileSync(
      resolve(targetDir, file),
      extractAgentForPlatform(content, platform),
      "utf-8"
    );
    log.info(`Installed ${platform} agent: ${file.replace(/\.md$/, "")}`);
    count++;
  }
  return count;
}

/** Remove PAL agents from a directory. */
function uninstallAgents(targetDir: string, label: string): string[] {
  const agentsDir = assets.agents();
  if (!existsSync(agentsDir)) return [];

  const removed: string[] = [];
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const dst = resolve(targetDir, file);
    if (existsSync(dst)) {
      unlinkSync(dst);
      removed.push(file.replace(/\.md$/, ""));
      log.info(`Removed ${label} agent: ${file.replace(/\.md$/, "")}`);
    }
  }
  return removed;
}

export function copyAgentsForOpencode(ocAgentsDir: string): number {
  return installAgents(ocAgentsDir, "opencode");
}

export function removeAgentsFromOpencode(ocAgentsDir: string): string[] {
  return uninstallAgents(ocAgentsDir, "opencode");
}

export function copyAgentsForCursor(cursorAgentsDir: string): number {
  return installAgents(cursorAgentsDir, "cursor");
}

export function removeAgentsFromCursor(cursorAgentsDir: string): string[] {
  return uninstallAgents(cursorAgentsDir, "cursor");
}

// --- Skill Index ---

interface SkillIndexEntry {
  name: string;
  description: string;
  triggers: string[];
}

interface SkillIndex {
  generated: string;
  totalSkills: number;
  skills: Record<string, SkillIndexEntry>;
}

/** Extract trigger keywords from a skill description */
function extractTriggers(description: string): string[] {
  // Extract "Use when ..." phrases and key terms
  const triggers = new Set<string>();

  const useWhen = description.match(/Use when\s+(.+?)(?:\.|$)/i);
  if (useWhen) {
    const words = useWhen[1]
      .toLowerCase()
      .split(/[,\s]+/)
      .filter(
        (w) =>
          w.length > 3 &&
          !["when", "this", "that", "with", "from", "about", "your", "the"].includes(w)
      );
    for (const w of words) triggers.add(w);
  }

  // Extract domain terms from full description
  const terms = description
    .toLowerCase()
    .match(
      /\b(research|analyze|extract|summarize|review|debug|reflect|council|debate|brainstorm|first.principles|security|pdf|youtube|telos|goals|projects|beliefs|challenges|opinion|skill|create)\b/g
    );
  if (terms) for (const t of terms) triggers.add(t);

  return [...triggers];
}

/**
 * Generate skill-index.json from installed skills in ~/.pal/skills/.
 * Called during install after skills are symlinked.
 */
export function generateSkillIndex(): number {
  if (!existsSync(PAL_SKILLS_DIR)) return 0;

  const index: SkillIndex = {
    generated: new Date().toISOString(),
    totalSkills: 0,
    skills: {},
  };

  for (const name of readdirSync(PAL_SKILLS_DIR)) {
    const skillMd = resolve(PAL_SKILLS_DIR, name, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    try {
      const content = readFileSync(skillMd, "utf-8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*"?(.+?)"?\s*$/m);
      if (!nameMatch) continue;

      const skillName = nameMatch[1].trim();
      const description = descMatch?.[1]?.trim() ?? "";

      index.skills[skillName] = {
        name: skillName,
        description,
        triggers: extractTriggers(description),
      };
      index.totalSkills++;
    } catch {
      /* skip unreadable skills */
    }
  }

  // Write to state directory
  const stateDir = resolve(palHome(), "memory", "state");
  mkdirSync(stateDir, { recursive: true });
  writeJson(resolve(stateDir, "skill-index.json"), index);
  log.info(`Skill index: ${index.totalSkills} skills indexed`);

  return index.totalSkills;
}

/** Count skill subdirectories in ~/.pal/skills/ */
export function countSkills(): number {
  if (!existsSync(PAL_SKILLS_DIR)) return 0;
  try {
    return readdirSync(PAL_SKILLS_DIR).filter((f) =>
      existsSync(resolve(PAL_SKILLS_DIR, f, "SKILL.md"))
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
