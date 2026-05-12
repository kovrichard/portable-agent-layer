/**
 * PAL — Copilot target installer
 * Writes hooks to ~/.copilot/hooks/pal-hooks.json.
 * Copies skills and agents. Writes ~/.copilot/instructions/pal-*.instructions.md.
 * Enables ~/.copilot/instructions in VS Code chat.instructionsFilesLocations.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeContextDigests } from "../../hooks/handlers/context-digests";
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
  readJson,
  scaffoldPalSettings,
  vscodeSettingsFile,
  writeJson,
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

// --- Generate AGENTS.md ---
regenerateIfNeeded();
log.success("Generated AGENTS.md");

// --- Write ~/.copilot/instructions/pal-*.instructions.md ---
mkdirSync(resolve(COPILOT_DIR, "instructions"), { recursive: true });
writeContextDigests();
log.success(
  "Written ~/.copilot/instructions/pal-self-model + pal-wisdom + pal-opinions.instructions.md"
);

// --- Enable ~/.copilot/instructions in VS Code settings ---
const vsSettingsPath = vscodeSettingsFile();
const manualHint =
  'Add manually: { "chat.instructionsFilesLocations": { "~/.copilot/instructions": true } }';
if (vsSettingsPath) {
  try {
    const settings = readJson<Record<string, unknown>>(vsSettingsPath, {});
    const existing =
      typeof settings["chat.instructionsFilesLocations"] === "object" &&
      settings["chat.instructionsFilesLocations"] !== null
        ? (settings["chat.instructionsFilesLocations"] as Record<string, unknown>)
        : {};
    settings["chat.instructionsFilesLocations"] = {
      ...existing,
      "~/.copilot/instructions": true,
    };
    writeJson(vsSettingsPath, settings);
    log.success("Enabled ~/.copilot/instructions in VS Code settings");
  } catch {
    log.warn(`Could not update VS Code settings — ${manualHint}`);
  }
} else {
  log.warn(`Could not detect VS Code settings path — ${manualHint}`);
}

log.success("Copilot installation complete");
console.log("");
log.info(`Skills: ${countSkills()}`);
log.info(`Hooks: ${HOOKS_FILE}`);
