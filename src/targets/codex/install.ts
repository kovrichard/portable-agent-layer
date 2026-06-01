/**
 * PAL — Codex target installer
 * Merges PAL hooks into ~/.codex/hooks.json (never overwrites user hooks).
 * Symlinks skills. Ensures AGENTS.md symlink via regenerateIfNeeded().
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { regenerateIfNeeded } from "../../hooks/lib/claude-md";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  addCodexStatuslineConfig,
  copySkills,
  countSkills,
  generateSkillIndex,
  loadCodexHooksTemplate,
  loadCodexRulesTemplate,
  log,
  mergeCodexHooks,
  mergeCodexRules,
  readJson,
  scaffoldPalSettings,
  writeJson,
} from "../lib";

/**
 * Ensure `features.hooks = true` in config.toml without touching other content.
 * Appends the setting if missing; skips if already present.
 */
function enableCodexHooks(configPath: string): void {
  let content = "";
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
    // Already enabled — nothing to do
    if (/^\s*hooks\s*=\s*true/m.test(content)) {
      log.info("Codex hooks already enabled in config.toml");
      return;
    }
    // [features] section exists but no hooks line — insert after the header
    if (/^\[features\]/m.test(content)) {
      content = content.replace(/(\[features\][^\n]*\n)/, "$1hooks = true\n");
      writeFileSync(configPath, content, "utf-8");
      log.success("Added hooks = true to existing [features] section in config.toml");
      return;
    }
  }
  // No config.toml, or no [features] section — append the block
  const block = `${content.endsWith("\n") || content === "" ? "" : "\n"}\n[features]\nhooks = true\n`;
  writeFileSync(configPath, content + block, "utf-8");
  log.success("Enabled hooks = true in ~/.codex/config.toml");
}

function enableCodexStatusline(configPath: string): void {
  const content = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const updated = addCodexStatuslineConfig(content);
  if (updated === content) {
    log.info("Codex status line already configured in config.toml");
    return;
  }
  writeFileSync(configPath, updated, "utf-8");
  log.success("Configured Codex TUI status line in ~/.codex/config.toml");
}

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CODEX_DIR = platform.codexDir();
const HOOKS_FILE = resolve(CODEX_DIR, "hooks.json");
const RULES_FILE = resolve(CODEX_DIR, "rules", "default.rules");

// --- Ensure ~/.codex/ exists ---
mkdirSync(CODEX_DIR, { recursive: true });

// --- Merge hooks ---
if (existsSync(HOOKS_FILE)) {
  copyFileSync(HOOKS_FILE, `${HOOKS_FILE}.bak.${Date.now()}`);
  log.info("Backed up hooks.json");
}

const template = loadCodexHooksTemplate(assets.codexHooksTemplate(), PKG_ROOT);
const existing = readJson<Record<string, unknown>>(HOOKS_FILE, {});
const merged = mergeCodexHooks(existing, template);

writeJson(HOOKS_FILE, merged);
log.success("Merged PAL hooks into ~/.codex/hooks.json");

// --- Merge allowlist rules ---
mkdirSync(resolve(CODEX_DIR, "rules"), { recursive: true });
if (existsSync(RULES_FILE)) {
  copyFileSync(RULES_FILE, `${RULES_FILE}.bak.${Date.now()}`);
  log.info("Backed up rules/default.rules");
}
const rulesTemplate = loadCodexRulesTemplate(assets.codexRulesTemplate());
const existingRules = existsSync(RULES_FILE) ? readFileSync(RULES_FILE, "utf-8") : "";
writeFileSync(RULES_FILE, mergeCodexRules(existingRules, rulesTemplate), "utf-8");
log.success("Merged PAL allowlist rules into ~/.codex/rules/default.rules");

// --- Symlink skills to ~/.codex/skills/ ---
const codexSkillsDir = resolve(CODEX_DIR, "skills");
copySkills(codexSkillsDir);
generateSkillIndex();

// --- Scaffold PAL settings ---
scaffoldPalSettings();

// --- Generate / verify AGENTS.md symlink ---
regenerateIfNeeded();
log.success("Ensured AGENTS.md symlink at ~/.codex/AGENTS.md");

// --- Enable hooks in config.toml ---
const CONFIG_FILE = resolve(CODEX_DIR, "config.toml");
enableCodexHooks(CONFIG_FILE);
enableCodexStatusline(CONFIG_FILE);

log.success("Codex installation complete");
console.log("");
log.info(`Skills: ${countSkills()}`);
log.info(`Hooks: ${HOOKS_FILE}`);
