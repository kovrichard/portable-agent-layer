/**
 * PAL — Copilot target installer
 * Writes hooks to ~/.copilot/hooks/pal-hooks.json.
 * Copies skills and agents. Symlinks copilot-instructions.md to AGENTS.md.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { regenerateIfNeeded } from "../../hooks/lib/claude-md";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  copyAgentsForCopilot,
  copyPalDocs,
  copySkills,
  countSkills,
  generateSkillIndex,
  loadCopilotHooksTemplate,
  log,
  scaffoldPalSettings,
} from "../lib";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const COPILOT_DIR = platform.copilotDir();
const HOOKS_DIR = resolve(COPILOT_DIR, "hooks");
const HOOKS_FILE = resolve(HOOKS_DIR, "pal-hooks.json");

// --- Ensure dirs ---
mkdirSync(HOOKS_DIR, { recursive: true });

// --- Write hooks file ---
const template = loadCopilotHooksTemplate(assets.copilotHooksTemplate(), PKG_ROOT);
writeFileSync(HOOKS_FILE, `${JSON.stringify(template, null, 2)}\n`, "utf-8");
log.success(`Written hooks to ${HOOKS_FILE}`);

// --- Install skills ---
const copilotSkillsDir = resolve(COPILOT_DIR, "skills");
copySkills(copilotSkillsDir);
generateSkillIndex();
log.success("Installed skills to ~/.copilot/skills/");

// --- Install agents ---
const copilotAgentsDir = resolve(COPILOT_DIR, "agents");
const agentCount = copyAgentsForCopilot(copilotAgentsDir);
if (agentCount > 0) log.success(`Installed ${agentCount} agents to ~/.copilot/agents/`);

// --- Copy PAL docs ---
const palDocsCount = copyPalDocs();
log.success(`Installed ${palDocsCount} PAL docs to ~/.pal/docs/`);

// --- Scaffold PAL settings ---
scaffoldPalSettings();

// --- Generate AGENTS.md + copilot-instructions.md symlink ---
// ensureSymlinks() inside regenerateIfNeeded() handles the symlink once ~/.copilot/ exists
regenerateIfNeeded();
const instructionsPath = resolve(COPILOT_DIR, "copilot-instructions.md");
log.success(
  existsSync(instructionsPath)
    ? "copilot-instructions.md symlink present"
    : "Generated AGENTS.md (copilot-instructions.md symlink will be created on next session)"
);

log.success("Copilot installation complete");
console.log("");
log.info(`Skills: ${countSkills()}`);
log.info(`Hooks: ${HOOKS_FILE}`);
