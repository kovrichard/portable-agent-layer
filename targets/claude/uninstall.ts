/**
 * PAI — Claude Code uninstaller (TypeScript)
 * Removes PAI hooks, skills, and env from settings.json.
 */

import { existsSync, copyFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { log, readJson, writeJson, removeSkills } from "../lib";

const PAI_DIR = resolve(dirname(import.meta.dir), "..");
const CLAUDE_DIR = process.env.PAI_CLAUDE_DIR!;
const SETTINGS = resolve(CLAUDE_DIR, "settings.json");

if (!existsSync(SETTINGS)) {
  log.info("No settings.json found, nothing to do.");
  process.exit(0);
}

// --- Backup ---
copyFileSync(SETTINGS, `${SETTINGS}.bak.${Date.now()}`);
log.info("Backed up settings.json");

// --- Remove PAI hooks ---
type HookEntry = { matcher?: string; hooks?: Array<{ command?: string }>; command?: string };
type Settings = { hooks?: Record<string, HookEntry[]>; env?: Record<string, string> };

const settings = readJson<Settings>(SETTINGS, {});

if (settings.hooks) {
  for (const [event, entries] of Object.entries(settings.hooks)) {
    settings.hooks[event] = entries.filter((entry) => {
      // New format: { matcher, hooks: [{ command }] }
      if (entry.hooks) return !entry.hooks.some((h) => h.command?.includes(PAI_DIR));
      // Old flat format: { type, command }
      if (entry.command) return !entry.command.includes(PAI_DIR);
      return true;
    });
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

// --- Remove env ---
if (settings.env) {
  delete settings.env.PAI_DIR;
  if (Object.keys(settings.env).length === 0) delete settings.env;
}

writeJson(SETTINGS, settings);
log.success("Removed PAI hooks and env from settings.json");

// --- Remove PAI skills ---
const removed = removeSkills(PAI_DIR, resolve(CLAUDE_DIR, "skills"));
if (removed.length > 0) {
  log.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);
} else {
  log.info("No PAI skills found");
}

// --- Remove AGENTS.md and CLAUDE.md symlink ---
const agentsMd = resolve(process.env.PAI_OPENCODE_DIR!, "AGENTS.md");
const claudeMd = resolve(CLAUDE_DIR, "CLAUDE.md");
try { unlinkSync(claudeMd); log.success("Removed ~/.claude/CLAUDE.md"); } catch { /* gone */ }
try { unlinkSync(agentsMd); log.success("Removed ~/.config/opencode/AGENTS.md"); } catch { /* gone */ }

log.success("Claude Code uninstall complete");
