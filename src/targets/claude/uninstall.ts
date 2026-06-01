/**
 * PAL — Claude Code uninstaller (TypeScript)
 * Removes exactly what the settings template added, plus skills, agents, and PAL docs.
 */

import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  loadSettingsTemplate,
  log,
  readJson,
  removeAgents,
  removePalDocs,
  removeSkills,
  removeStatusline,
  removeStatuslineConfig,
  unmergeSettings,
  writeJson,
} from "../lib";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CLAUDE_DIR = platform.claudeDir();
const SETTINGS = resolve(CLAUDE_DIR, "settings.json");

if (!existsSync(SETTINGS)) {
  log.info("No settings.json found, nothing to do.");
  process.exit(0);
}

// --- Backup ---
copyFileSync(SETTINGS, `${SETTINGS}.bak.${Date.now()}`);
log.info("Backed up settings.json");

// --- Load template and unmerge from existing settings ---
const template = loadSettingsTemplate(assets.claudeSettingsTemplate(), PKG_ROOT);
const existing = readJson<Record<string, unknown>>(SETTINGS, {});
let cleaned = unmergeSettings(existing, template);

// Remove statusLine config
cleaned = removeStatuslineConfig(cleaned);

writeJson(SETTINGS, cleaned);
log.success("Removed PAL settings from settings.json");

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

// --- Remove statusline script ---
removeStatusline();

// --- Remove PAL system docs ---
removePalDocs();

// --- Remove AGENTS.md and CLAUDE.md ---
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
