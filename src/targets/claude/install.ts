/**
 * PAL — Claude Code target installer (TypeScript)
 * Merges settings template into existing settings.json (never overwrites).
 * Copies skills, agents, and PAL docs. Generates CLAUDE.md from TELOS.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assets, palHome, palPkg, platform } from "../../hooks/lib/paths";
import { identity, raw as readPalSettings } from "../../hooks/lib/settings";
import {
  addStatuslineConfig,
  applyAttribution,
  copyAgents,
  copySkills,
  copyStatusline,
  countAgents,
  countMd,
  countSkills,
  loadSettingsTemplate,
  log,
  mergeSettings,
  readJson,
  replaceJsonConfig,
} from "../lib";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CLAUDE_DIR = platform.claudeDir();
const SETTINGS = resolve(CLAUDE_DIR, "settings.json");

mkdirSync(CLAUDE_DIR, { recursive: true });
if (!existsSync(SETTINGS)) {
  writeFileSync(SETTINGS, "{}\n", "utf-8");
  log.info("Created new settings.json");
}

const template = loadSettingsTemplate(assets.claudeSettingsTemplate(), PKG_ROOT);
const existing = readJson<Record<string, unknown>>(SETTINGS, {});
let merged = mergeSettings(existing, template);

merged = addStatuslineConfig(merged);

// Apply the user's git-attribution choice (composed from identity name at runtime —
// never committed to assets). Only acts once the opt-in prompt has been answered.
const attribution = readPalSettings().attribution;
if (attribution?.decided) {
  merged = applyAttribution(merged, {
    enabled: attribution.enabled === true,
    name: identity().ai.name,
  });
}

replaceJsonConfig(SETTINGS, merged);
log.success("Merged PAL settings into settings.json");

const skillsDir = resolve(CLAUDE_DIR, "skills");
copySkills(skillsDir);

copyAgents();

copyStatusline();

log.success(
  `${countSkills()} skills · ${countAgents()} agents · ${countMd(resolve(palHome(), "telos"))} TELOS files · CLAUDE.md → AGENTS.md`
);
