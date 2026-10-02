/**
 * PAL — Copilot target installer
 * Writes hooks to ~/.copilot/hooks/pal-hooks.json.
 * Copies skills and agents. Writes ~/.copilot/instructions/pal-*.instructions.md.
 * Enables ~/.copilot/instructions in VS Code chat.instructionsFilesLocations.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  copyAgentsForCopilot,
  copySkills,
  countSkills,
  loadCopilotHooksTemplate,
  log,
  vscodeSettingsFile,
} from "../lib";
import { enableCopilotInstructions } from "../vscode-settings";

const PKG_ROOT = palPkg().replaceAll("\\", "/");
const COPILOT_DIR = platform.copilotDir();
const HOOKS_DIR = resolve(COPILOT_DIR, "hooks");
const HOOKS_FILE = resolve(HOOKS_DIR, "pal-hooks.json");
const VSCODE_HOOKS_FILE = resolve(HOOKS_DIR, "pal-vscode-hooks.json");

// --- Ensure dirs ---
mkdirSync(HOOKS_DIR, { recursive: true });

// --- Write hooks file ---
const template = loadCopilotHooksTemplate(assets.copilotHooksTemplate(), PKG_ROOT);
writeFileSync(HOOKS_FILE, `${JSON.stringify(template, null, 2)}\n`, "utf-8");
log.success(`Written hooks to ${HOOKS_FILE}`);

// --- Retire the separate VS Code hooks file ---
// VS Code's own Copilot build already executes the PascalCase hooks in
// ~/.claude/settings.json, so registering the same events here too ran every
// hook twice per turn. One dual-shape block payload (see lib/agent.ts) now
// serves both surfaces from that single registration.
if (existsSync(VSCODE_HOOKS_FILE)) {
  unlinkSync(VSCODE_HOOKS_FILE);
  log.success("Removed pal-vscode-hooks.json (VS Code runs the Claude hooks)");
}

// --- Install skills ---
const copilotSkillsDir = resolve(COPILOT_DIR, "skills");
copySkills(copilotSkillsDir);

// --- Install agents ---
const copilotAgentsDir = resolve(COPILOT_DIR, "agents");
const agentCount = copyAgentsForCopilot(copilotAgentsDir);
log.success(`${countSkills()} skills · ${agentCount} agents → ~/.copilot/`);

// --- Enable ~/.copilot/instructions in VS Code settings ---
const vsSettingsPath = vscodeSettingsFile();
const manualHint =
  'Add manually: { "chat.instructionsFilesLocations": { "~/.copilot/instructions": true } }';
if (vsSettingsPath) {
  try {
    const outcome = enableCopilotInstructions(vsSettingsPath);
    if (outcome === "enabled")
      log.success("Enabled ~/.copilot/instructions in VS Code settings");
    if (outcome === "needs-manual-edit")
      log.warn(
        `VS Code settings aren't plain JSON, so PAL left them untouched — ${manualHint}`
      );
    if (outcome === "vscode-never-launched")
      log.info("Skipped VS Code settings — VS Code has not been launched yet");
  } catch {
    log.warn(`Could not update VS Code settings — ${manualHint}`);
  }
} else {
  log.warn(`Could not detect VS Code settings path — ${manualHint}`);
}
