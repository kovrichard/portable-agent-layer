/**
 * PAL — Cursor uninstaller (TypeScript)
 * Removes only PAL-owned hooks from hooks.json. Preserves user hooks.
 * Removes PAL skill symlinks.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  loadCursorHooksTemplate,
  log,
  readJson,
  removeAgentsFromCursor,
  removePalContextFiles,
  removePalDocs,
  removeSkills,
  removeStatusline,
  removeStatuslineConfig,
  replaceJsonConfig,
  unmergeCursorHooks,
} from "../lib";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CURSOR_DIR = platform.cursorDir();
const HOOKS_FILE = resolve(CURSOR_DIR, "hooks.json");
const CLI_CONFIG = resolve(CURSOR_DIR, "cli-config.json");

if (existsSync(HOOKS_FILE)) {
  const template = loadCursorHooksTemplate(assets.cursorHooksTemplate(), PKG_ROOT);
  const existing = readJson<Record<string, unknown>>(HOOKS_FILE, {});
  const cleaned = unmergeCursorHooks(existing, template);

  replaceJsonConfig(HOOKS_FILE, cleaned);
  log.success("Removed PAL hooks from hooks.json");
} else {
  log.info("No hooks.json found, nothing to do");
}

const cursorSkillsDir = resolve(CURSOR_DIR, "skills");
const removed = removeSkills(cursorSkillsDir);
if (removed.length > 0) {
  log.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);
} else {
  log.info("No PAL skills found");
}

const removedAgents = removeAgentsFromCursor(resolve(CURSOR_DIR, "agents"));
if (removedAgents.length > 0) {
  log.success(`Removed ${removedAgents.length} agent(s): ${removedAgents.join(", ")}`);
}

removePalDocs();

if (existsSync(CLI_CONFIG)) {
  const cliConfig = readJson<Record<string, unknown>>(CLI_CONFIG, {});
  replaceJsonConfig(CLI_CONFIG, removeStatuslineConfig(cliConfig, "cursor"));
  log.success("Removed PAL statusLine from cli-config.json");
} else {
  log.info("No cli-config.json found, skipping statusLine removal");
}
removeStatusline("cursor");

const removedRules = removePalContextFiles(resolve(CURSOR_DIR, "rules"), ".mdc");
log.success(`Removed ${removedRules.length} ~/.cursor/rules/pal-*.mdc`);

log.success("Cursor uninstall complete");
