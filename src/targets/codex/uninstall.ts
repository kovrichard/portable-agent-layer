/**
 * PAL — Codex uninstaller
 * Removes only PAL-owned hooks from ~/.codex/hooks.json. Preserves user hooks.
 * Removes PAL skill symlinks and PAL agents.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  loadCodexHooksTemplate,
  log,
  readJson,
  removeAgentsFromCodex,
  removeCodexStatuslineConfig,
  removeSkills,
  replaceConfig,
  replaceJsonConfig,
  unmergeCodexHooks,
  unmergeCodexRules,
} from "../lib";

/**
 * Remove `hooks = true` from config.toml.
 * Also removes a now-empty [features] section header.
 */
function disableCodexHooks(configPath: string): void {
  if (!existsSync(configPath)) return;
  let content = readFileSync(configPath, "utf-8");
  if (!/^\s*hooks\s*=\s*true/m.test(content)) return;

  // Remove the hooks line
  content = content.replace(/^[ \t]*hooks\s*=\s*true[ \t]*\n?/m, "");

  // Remove [features] header if it's now empty (nothing between it and next section / EOF)
  content = content.replace(/\[features\]\n(?=\[|$)/m, "");

  writeFileSync(configPath, content, "utf-8");
  log.success("Removed hooks from ~/.codex/config.toml");
}

function disableCodexStatusline(configPath: string): void {
  if (!existsSync(configPath)) return;
  const content = readFileSync(configPath, "utf-8");
  const updated = removeCodexStatuslineConfig(content);
  if (updated === content) return;
  writeFileSync(configPath, updated, "utf-8");
  log.success("Removed PAL Codex status line from ~/.codex/config.toml");
}

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CODEX_DIR = platform.codexDir();
const HOOKS_FILE = resolve(CODEX_DIR, "hooks.json");
const RULES_FILE = resolve(CODEX_DIR, "rules", "default.rules");

// --- Remove PAL hooks from hooks.json ---
if (existsSync(HOOKS_FILE)) {
  const template = loadCodexHooksTemplate(assets.codexHooksTemplate(), PKG_ROOT);
  const existing = readJson<Record<string, unknown>>(HOOKS_FILE, {});
  const cleaned = unmergeCodexHooks(existing, template);

  replaceJsonConfig(HOOKS_FILE, cleaned);
  log.success("Removed PAL hooks from ~/.codex/hooks.json");
} else {
  log.info("No hooks.json found, nothing to do");
}

// --- Remove PAL allowlist rules from default.rules ---
if (existsSync(RULES_FILE)) {
  const cleanedRules = unmergeCodexRules(readFileSync(RULES_FILE, "utf-8"));
  replaceConfig(RULES_FILE, cleanedRules);
  log.success("Removed PAL allowlist rules from ~/.codex/rules/default.rules");
} else {
  log.info("No default.rules found, nothing to do");
}

// --- Remove PAL skill symlinks ---
const codexSkillsDir = resolve(CODEX_DIR, "skills");
const removed = removeSkills(codexSkillsDir);
if (removed.length > 0) {
  log.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);
} else {
  log.info("No PAL skills found");
}

// --- Remove PAL agents ---
const removedAgents = removeAgentsFromCodex(resolve(CODEX_DIR, "agents"));
if (removedAgents.length > 0) {
  log.success(`Removed ${removedAgents.length} agent(s): ${removedAgents.join(", ")}`);
}

// --- Disable hooks in config.toml ---
const CONFIG_FILE = resolve(CODEX_DIR, "config.toml");
disableCodexHooks(CONFIG_FILE);
disableCodexStatusline(CONFIG_FILE);

log.success("Codex uninstall complete");
