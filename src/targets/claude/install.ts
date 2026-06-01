/**
 * PAL — Claude Code target installer (TypeScript)
 * Merges settings template into existing settings.json (never overwrites).
 * Copies skills, agents, and PAL docs. Generates CLAUDE.md from TELOS.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { regenerateIfNeeded } from "../../hooks/lib/claude-md";
import { assets, palHome, palPkg, platform } from "../../hooks/lib/paths";
import {
  addStatuslineConfig,
  copyAgents,
  copyPalDocs,
  copySkills,
  copyStatusline,
  countAgents,
  countMd,
  countSkills,
  generateSkillIndex,
  loadSettingsTemplate,
  log,
  mergeSettings,
  readJson,
  scaffoldPalSettings,
  writeJson,
} from "../lib";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CLAUDE_DIR = platform.claudeDir();
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

// --- Load template and merge into existing settings ---
const template = loadSettingsTemplate(assets.claudeSettingsTemplate(), PKG_ROOT);
const existing = readJson<Record<string, unknown>>(SETTINGS, {});
let merged = mergeSettings(existing, template);

// Add platform-specific statusLine config
merged = addStatuslineConfig(merged);

writeJson(SETTINGS, merged);
log.success("Merged PAL settings into settings.json");

// --- Copy skills ---
const skillsDir = resolve(CLAUDE_DIR, "skills");
copySkills(skillsDir);
generateSkillIndex();

// --- Copy agents ---
copyAgents();

// --- Copy statusline script ---
copyStatusline();

// --- Copy PAL system docs ---
const palDocsCount = copyPalDocs();
log.success(`Installed ${palDocsCount} PAL docs to ~/.pal/docs/`);

// --- Scaffold PAL settings ---
scaffoldPalSettings();

// --- Generate ~/.claude/AGENTS.md and symlink ~/.claude/CLAUDE.md → AGENTS.md ---
regenerateIfNeeded();
log.success("Generated ~/.config/opencode/AGENTS.md (→ ~/.claude/CLAUDE.md symlink)");

log.success("Claude Code installation complete");
console.log("");
log.info(`Skills: ${countSkills()}`);
log.info(`Agents: ${countAgents()}`);
log.info(`TELOS: ${countMd(resolve(palHome(), "telos"))} files`);
