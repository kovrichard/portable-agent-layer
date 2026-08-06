/**
 * PAL — Copilot uninstaller
 * Removes pal-hooks.json, skill symlinks, agents, instruction files,
 * and the VS Code chat.instructionsFilesLocations entry.
 */

import { copyFileSync, existsSync, lstatSync, readlinkSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { platform } from "../../hooks/lib/paths";
import {
  log,
  readJson,
  removeAgentsFromCopilot,
  removePalContextFiles,
  removePalDocs,
  removeSkills,
  vscodeSettingsFile,
  writeJson,
} from "../lib";

const COPILOT_DIR = platform.copilotDir();
const HOOKS_FILE = resolve(COPILOT_DIR, "hooks", "pal-hooks.json");
const VSCODE_HOOKS_FILE = resolve(COPILOT_DIR, "hooks", "pal-vscode-hooks.json");

// --- Remove hooks files ---
function removeHooksFile(path: string, label: string): void {
  if (!existsSync(path)) {
    log.info(`No ${label} found, nothing to do`);
    return;
  }
  copyFileSync(path, `${path}.bak.${Date.now()}`);
  unlinkSync(path);
  log.success(`Removed ${label}`);
}

removeHooksFile(HOOKS_FILE, "pal-hooks.json");
removeHooksFile(VSCODE_HOOKS_FILE, "pal-vscode-hooks.json");

// --- Remove skill symlinks ---
const copilotSkillsDir = resolve(COPILOT_DIR, "skills");
const removed = removeSkills(copilotSkillsDir);
if (removed.length > 0) {
  log.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);
} else {
  log.info("No PAL skills found");
}

// --- Remove agents ---
const removedAgents = removeAgentsFromCopilot(resolve(COPILOT_DIR, "agents"));
if (removedAgents.length > 0) {
  log.success(`Removed ${removedAgents.length} agent(s): ${removedAgents.join(", ")}`);
}

// --- Remove PAL docs ---
removePalDocs();

// --- Remove ~/.copilot/instructions/pal-*.instructions.md ---
const removedInstructions = removePalContextFiles(
  resolve(COPILOT_DIR, "instructions"),
  ".instructions.md"
);
log.success(
  `Removed ${removedInstructions.length} ~/.copilot/instructions/pal-*.instructions.md`
);

// --- Backward compat: remove old copilot-instructions.md symlink if present ---
const legacyPath = resolve(COPILOT_DIR, "copilot-instructions.md");
if (existsSync(legacyPath)) {
  try {
    if (
      lstatSync(legacyPath).isSymbolicLink() &&
      readlinkSync(legacyPath).includes("AGENTS.md")
    ) {
      unlinkSync(legacyPath);
      log.success("Removed legacy copilot-instructions.md symlink");
    }
  } catch {
    /* ignore */
  }
}

// --- Remove ~/.copilot/instructions entry from VS Code settings ---
const vsSettingsPath = vscodeSettingsFile();
if (vsSettingsPath && existsSync(vsSettingsPath)) {
  const settings = readJson<Record<string, unknown>>(vsSettingsPath, {});
  const locs = settings["chat.instructionsFilesLocations"];
  if (typeof locs === "object" && locs !== null) {
    const obj = locs as Record<string, unknown>;
    delete obj["~/.copilot/instructions"];
    if (Object.keys(obj).length === 0) {
      delete settings["chat.instructionsFilesLocations"];
    } else {
      settings["chat.instructionsFilesLocations"] = obj;
    }
    writeJson(vsSettingsPath, settings);
    log.success("Removed ~/.copilot/instructions from VS Code settings");
  }
}

log.success("Copilot uninstall complete");
