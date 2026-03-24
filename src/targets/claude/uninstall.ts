/**
 * PAL — Claude Code uninstaller (TypeScript)
 * Removes PAL hooks, skills, and env from settings.json.
 */

import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { palPkg, platform } from "../../hooks/lib/paths";
import {
  log,
  readJson,
  removeAgents,
  removePalDocs,
  removeSkills,
  writeJson,
} from "../lib";

const PKG_ROOT = palPkg();
const CLAUDE_DIR = platform.claudeDir();
const SETTINGS = resolve(CLAUDE_DIR, "settings.json");

if (!existsSync(SETTINGS)) {
  log.info("No settings.json found, nothing to do.");
  process.exit(0);
}

// --- Backup ---
copyFileSync(SETTINGS, `${SETTINGS}.bak.${Date.now()}`);
log.info("Backed up settings.json");

// --- Remove PAL hooks ---
type HookEntry = {
  matcher?: string;
  hooks?: Array<{ command?: string }>;
  command?: string;
};
type Settings = { hooks?: Record<string, HookEntry[]>; env?: Record<string, string> };

const settings = readJson<Settings>(SETTINGS, {});

if (settings.hooks) {
  for (const [event, entries] of Object.entries(settings.hooks)) {
    settings.hooks[event] = entries.filter((entry) => {
      // New format: { matcher, hooks: [{ command }] }
      if (entry.hooks) return !entry.hooks.some((h) => h.command?.includes(PKG_ROOT));
      // Old flat format: { type, command }
      if (entry.command) return !entry.command.includes(PKG_ROOT);
      return true;
    });
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

// --- Remove env ---
if (settings.env) {
  // Clean up env vars
  delete settings.env.PAL_DIR;
  if (Object.keys(settings.env).length === 0) delete settings.env;
}

// --- Remove PAL tool permissions ---
type SettingsWithPermissions = Settings & { permissions?: { allow?: string[] } };
const s = settings as SettingsWithPermissions;
if (s.permissions?.allow) {
  s.permissions.allow = s.permissions.allow.filter(
    (p) => !p.includes(PKG_ROOT) && !p.startsWith("Bash(bun run ai:")
  );
  if (s.permissions.allow.length === 0) delete s.permissions.allow;
  if (Object.keys(s.permissions).length === 0) delete s.permissions;
}

writeJson(SETTINGS, settings);
log.success("Removed PAL hooks and env from settings.json");

// --- Remove PAL skills ---
const removed = removeSkills(resolve(CLAUDE_DIR, "skills"));
if (removed.length > 0) {
  log.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);
} else {
  log.info("No PAL skills found");
}

// --- Remove PAL agents ---
const removedAgents = removeAgents();
if (removedAgents.length > 0) {
  log.success(`Removed ${removedAgents.length} agent(s): ${removedAgents.join(", ")}`);
} else {
  log.info("No PAL agents found");
}

// --- Remove PAL system docs ---
removePalDocs();

// --- Remove AGENTS.md and CLAUDE.md symlink ---
const agentsMd = resolve(platform.opencodeDir(), "AGENTS.md");
const claudeMd = resolve(CLAUDE_DIR, "CLAUDE.md");
try {
  unlinkSync(claudeMd);
  log.success("Removed ~/.claude/CLAUDE.md");
} catch {
  /* gone */
}
try {
  unlinkSync(agentsMd);
  log.success("Removed ~/.config/opencode/AGENTS.md");
} catch {
  /* gone */
}

log.success("Claude Code uninstall complete");
