/**
 * PAL — Codex target installer
 * Merges PAL hooks into ~/.codex/hooks.json (never overwrites user hooks).
 * Symlinks skills, renders agents to TOML. Ensures AGENTS.md symlink via regenerateIfNeeded().
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  addCodexStatuslineConfig,
  copyAgentsForCodex,
  copySkills,
  countSkills,
  loadCodexHooksTemplate,
  loadCodexRulesTemplate,
  log,
  mergeCodexHooks,
  mergeCodexRules,
  readJson,
  replaceConfig,
  replaceJsonConfig,
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

mkdirSync(CODEX_DIR, { recursive: true });

const template = loadCodexHooksTemplate(assets.codexHooksTemplate(), PKG_ROOT);
const existing = readJson<Record<string, unknown>>(HOOKS_FILE, {});
const merged = mergeCodexHooks(existing, template);

replaceJsonConfig(HOOKS_FILE, merged);
log.success(`Merged PAL hooks into ${HOOKS_FILE}`);

mkdirSync(resolve(CODEX_DIR, "rules"), { recursive: true });
const rulesTemplate = loadCodexRulesTemplate(assets.codexRulesTemplate());
const existingRules = existsSync(RULES_FILE) ? readFileSync(RULES_FILE, "utf-8") : "";
replaceConfig(RULES_FILE, mergeCodexRules(existingRules, rulesTemplate));
log.success("Merged PAL allowlist rules into ~/.codex/rules/default.rules");

const codexSkillsDir = resolve(CODEX_DIR, "skills");
copySkills(codexSkillsDir);
log.success(`${countSkills()} skills → ~/.codex/skills/`);

const agentCount = copyAgentsForCodex(resolve(CODEX_DIR, "agents"));
log.success(`${agentCount} agents → ~/.codex/agents/`);

const CONFIG_FILE = resolve(CODEX_DIR, "config.toml");
enableCodexHooks(CONFIG_FILE);
enableCodexStatusline(CONFIG_FILE);
