/**
 * PAL — Cursor uninstaller (TypeScript)
 * Removes only PAL-owned hooks from hooks.json. Preserves user hooks.
 * Removes PAL skill symlinks.
 */

import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  loadCursorHooksTemplate,
  log,
  readJson,
  removeAgentsFromCursor,
  removePalDocs,
  removeSkills,
  unmergeCursorHooks,
  writeJson,
} from "../lib";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CURSOR_DIR = platform.cursorDir();
const HOOKS_FILE = resolve(CURSOR_DIR, "hooks.json");

// --- Remove PAL hooks from hooks.json ---
if (existsSync(HOOKS_FILE)) {
  // Backup before modifying
  copyFileSync(HOOKS_FILE, `${HOOKS_FILE}.bak.${Date.now()}`);
  log.info("Backed up hooks.json");

  const template = loadCursorHooksTemplate(assets.cursorHooksTemplate(), PKG_ROOT);
  const existing = readJson<Record<string, unknown>>(HOOKS_FILE, {});
  const cleaned = unmergeCursorHooks(existing, template);

  writeJson(HOOKS_FILE, cleaned);
  log.success("Removed PAL hooks from hooks.json");
} else {
  log.info("No hooks.json found, nothing to do");
}

// --- Remove PAL skill symlinks ---
const cursorSkillsDir = resolve(CURSOR_DIR, "skills");
const removed = removeSkills(cursorSkillsDir);
if (removed.length > 0) {
  log.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);
} else {
  log.info("No PAL skills found");
}

// --- Remove PAL agents ---
const removedAgents = removeAgentsFromCursor(resolve(CURSOR_DIR, "agents"));
if (removedAgents.length > 0) {
  log.success(`Removed ${removedAgents.length} agent(s): ${removedAgents.join(", ")}`);
}

// --- Remove PAL system docs ---
removePalDocs();

// --- Remove ~/.cursor/rules/pal-*.mdc ---
for (const f of [
  "pal-context.mdc",
  "pal-self-model.mdc",
  "pal-wisdom.mdc",
  "pal-opinions.mdc",
]) {
  try {
    unlinkSync(resolve(CURSOR_DIR, "rules", f));
  } catch {
    /* gone */
  }
}
log.success("Removed ~/.cursor/rules/pal-*.mdc");

log.success("Cursor uninstall complete");
