/**
 * PAL — Cursor target installer (TypeScript)
 * Merges hooks template into existing hooks.json (never overwrites).
 * Symlinks skills. Generates AGENTS.md.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { writeContextDigests } from "../../hooks/handlers/context-digests";
import { regenerateIfNeeded } from "../../hooks/lib/claude-md";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  copyAgentsForCursor,
  copyPalDocs,
  copySkills,
  countSkills,
  generateSkillIndex,
  loadCursorHooksTemplate,
  log,
  mergeCursorHooks,
  readJson,
  scaffoldPalSettings,
  writeJson,
} from "../lib";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const CURSOR_DIR = platform.cursorDir();
const HOOKS_FILE = resolve(CURSOR_DIR, "hooks.json");

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
log.success("Merged PAL hooks into hooks.json");

// --- Symlink skills to ~/.cursor/skills/ ---
const cursorSkillsDir = resolve(CURSOR_DIR, "skills");
copySkills(cursorSkillsDir);
generateSkillIndex();

// --- Copy agents to ~/.cursor/agents/ ---
const cursorAgentsDir = resolve(CURSOR_DIR, "agents");
const agentCount = copyAgentsForCursor(cursorAgentsDir);
if (agentCount > 0) log.success(`Installed ${agentCount} agents to ~/.cursor/agents/`);

// --- Copy PAL system docs ---
const palDocsCount = copyPalDocs();
log.success(`Installed ${palDocsCount} PAL docs to ~/.pal/docs/`);

// --- Scaffold PAL settings ---
scaffoldPalSettings();

// --- Generate AGENTS.md ---
regenerateIfNeeded();
log.success("Generated AGENTS.md");

// --- Write ~/.cursor/rules/pal-context.mdc ---
mkdirSync(resolve(CURSOR_DIR, "rules"), { recursive: true });
writeContextDigests();
log.success("Written ~/.cursor/rules/pal-context.mdc");

log.success("Cursor installation complete");
console.log("");
log.info(`Skills: ${countSkills()}`);
log.info(`Hooks: ${HOOKS_FILE}`);
log.info(
  "Note: Cursor tool matchers may need tuning — verify hook behavior after first use"
);
