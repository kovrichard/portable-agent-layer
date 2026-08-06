/**
 * PAL — Cursor target installer (TypeScript)
 * Merges hooks template into existing hooks.json (never overwrites).
 * Symlinks skills. Generates AGENTS.md.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  addStatuslineConfig,
  copyAgentsForCursor,
  copySkills,
  copyStatusline,
  countSkills,
  loadCursorHooksTemplate,
  log,
  mergeCursorHooks,
  readJson,
  writeJson,
} from "../lib";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CURSOR_DIR = platform.cursorDir();
const HOOKS_FILE = resolve(CURSOR_DIR, "hooks.json");
const CLI_CONFIG = resolve(CURSOR_DIR, "cli-config.json");

// --- Ensure ~/.cursor/ exists ---
mkdirSync(CURSOR_DIR, { recursive: true });

// --- Merge hooks ---
if (existsSync(HOOKS_FILE)) {
  const backup = `${HOOKS_FILE}.bak.${Date.now()}`;
  copyFileSync(HOOKS_FILE, backup);
  log.info("Backed up hooks.json");
}

const template = loadCursorHooksTemplate(assets.cursorHooksTemplate(), PKG_ROOT);
const existing = readJson<Record<string, unknown>>(HOOKS_FILE, {});
const merged = mergeCursorHooks(existing, template);

writeJson(HOOKS_FILE, merged);
log.success(`Merged PAL hooks into ${HOOKS_FILE}`);

// --- Symlink skills to ~/.cursor/skills/ ---
const cursorSkillsDir = resolve(CURSOR_DIR, "skills");
copySkills(cursorSkillsDir);

// --- Copy agents to ~/.cursor/agents/ ---
const cursorAgentsDir = resolve(CURSOR_DIR, "agents");
const agentCount = copyAgentsForCursor(cursorAgentsDir);
log.success(`${countSkills()} skills · ${agentCount} agents → ~/.cursor/`);

// --- Statusline script + cli-config.json statusLine ---
copyStatusline("cursor");
if (!existsSync(CLI_CONFIG)) {
  writeFileSync(CLI_CONFIG, "{}\n", "utf-8");
  log.info("Created new cli-config.json");
} else {
  copyFileSync(CLI_CONFIG, `${CLI_CONFIG}.bak.${Date.now()}`);
  log.info("Backed up cli-config.json");
}
const cliConfig = readJson<Record<string, unknown>>(CLI_CONFIG, {});
writeJson(CLI_CONFIG, addStatuslineConfig(cliConfig, "cursor"));
log.success("Merged statusLine into cli-config.json");

log.info(
  "Note: Cursor tool matchers may need tuning — verify hook behavior after first use"
);
