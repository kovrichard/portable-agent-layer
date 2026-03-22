/**
 * PAL — Claude Code target installer (TypeScript)
 * Merges hooks into existing settings.json (never overwrites).
 * Copies skills additively. Generates CLAUDE.md from TELOS.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { regenerateIfNeeded } from "../../hooks/lib/claude-md";
import { palHome, palPkg } from "../../hooks/lib/paths";
import {
  copyAgents,
  copySkills,
  countAgents,
  countMd,
  countSkills,
  log,
  readJson,
  writeJson,
} from "../lib";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CLAUDE_DIR = process.env.PAL_CLAUDE_DIR!;
const SETTINGS = resolve(CLAUDE_DIR, "settings.json");

// --- Ensure settings.json exists ---
mkdirSync(CLAUDE_DIR, { recursive: true });
if (!existsSync(SETTINGS)) {
  writeFileSync(SETTINGS, "{}\n", "utf-8");
  log.info("Created new settings.json");
}

// --- Backup ---
const backup = `${SETTINGS}.bak.${Date.now()}`;
copyFileSync(SETTINGS, backup);
log.info("Backed up settings.json");

// --- Build hooks payload ---
const hooksPayload = {
  hooks: {
    SessionStart: [
      {
        matcher: "",
        hooks: [
          { type: "command", command: `bun run ${PKG_ROOT}/src/hooks/LoadContext.ts` },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `bun run ${PKG_ROOT}/src/hooks/UserPromptOrchestrator.ts`,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Bash|Write|Edit",
        hooks: [
          {
            type: "command",
            command: `bun run ${PKG_ROOT}/src/hooks/SecurityValidator.ts`,
          },
        ],
      },
      {
        matcher: "Skill",
        hooks: [
          { type: "command", command: `bun run ${PKG_ROOT}/src/hooks/SkillGuard.ts` },
        ],
      },
    ],
    Stop: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `bun run ${PKG_ROOT}/src/hooks/StopOrchestrator.ts`,
          },
        ],
      },
    ],
  },
};

// --- Merge hooks additively (deduplicate by command) ---
type HookEntry = { matcher: string; hooks: Array<{ type: string; command: string }> };
type Settings = { hooks?: Record<string, HookEntry[]>; env?: Record<string, string> };

const settings = readJson<Settings>(SETTINGS, {});
if (!settings.hooks) settings.hooks = {};

for (const [event, entries] of Object.entries(hooksPayload.hooks)) {
  const existing = settings.hooks[event] ?? [];
  for (const entry of entries) {
    const cmd = entry.hooks[0]?.command;
    const alreadyPresent = existing.some((e) => e.hooks?.[0]?.command === cmd);
    if (!alreadyPresent) existing.push(entry);
  }
  settings.hooks[event] = existing;
}

// --- Set env (persist platform paths from shell scripts so hooks get them) ---
if (!settings.env) settings.env = {};
settings.env.PAL_CLAUDE_DIR = CLAUDE_DIR;
settings.env.PAL_OPENCODE_DIR = process.env.PAL_OPENCODE_DIR!;
settings.env.PAL_AGENTS_DIR = process.env.PAL_AGENTS_DIR!;

// --- Add PAL tool permissions (auto-allow ai: scripts) ---
type SettingsWithPermissions = Settings & { permissions?: { allow?: string[] } };
const s = settings as SettingsWithPermissions;
if (!s.permissions) s.permissions = {};
if (!s.permissions.allow) s.permissions.allow = [];
const aiTools = [
  "ai:entity-save",
  "ai:fyzz-api",
  "ai:pdf-download",
  "ai:youtube-analyze",
];
for (const tool of aiTools) {
  const perm = `Bash(bun run ${tool} *)`;
  if (!s.permissions.allow.includes(perm)) {
    s.permissions.allow.push(perm);
  }
}

writeJson(SETTINGS, settings);
log.success("Merged hooks into settings.json");

// --- Copy skills ---
const skillsDir = resolve(CLAUDE_DIR, "skills");
copySkills(skillsDir);

// --- Copy agents ---
copyAgents();

// --- Generate ~/.claude/AGENTS.md and symlink ~/.claude/CLAUDE.md → AGENTS.md ---
regenerateIfNeeded();
log.success("Generated ~/.config/opencode/AGENTS.md (→ ~/.claude/CLAUDE.md symlink)");

log.success("Claude Code installation complete");
console.log("");
log.info(`Hooks: 5 (SessionStart, UserPromptSubmit, PreToolUse×2, Stop)`);
log.info(`Skills: ${countSkills()}`);
log.info(`Agents: ${countAgents()}`);
log.info(`TELOS: ${countMd(resolve(palHome(), "telos"))} files`);
