/**
 * PAL — Copilot uninstaller
 * Removes pal-hooks.json, skill symlinks, agents, instruction files,
 * and the VS Code chat.instructionsFilesLocations entry.
 */

import { copyFileSync, existsSync, lstatSync, readlinkSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { platform } from "../../hooks/lib/paths";
import { copilotFilename, getSemiStaticSources } from "../../hooks/lib/semi-static";
import {
  log,
  readJson,
  removeAgentsFromCopilot,
  removePalDocs,
  removeSkills,
  vscodeSettingsFile,
  writeJson,
} from "../lib";

const COPILOT_DIR = platform.copilotDir();
const HOOKS_FILE = resolve(COPILOT_DIR, "hooks", "pal-hooks.json");

// --- Remove hooks file ---
if (existsSync(HOOKS_FILE)) {
  copyFileSync(HOOKS_FILE, `${HOOKS_FILE}.bak.${Date.now()}`);
  unlinkSync(HOOKS_FILE);
  log.success("Removed pal-hooks.json");
} else {
  log.info("No pal-hooks.json found, nothing to do");
}

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
for (const src of getSemiStaticSources()) {
  try {
    unlinkSync(resolve(COPILOT_DIR, "instructions", copilotFilename(src)));
  } catch {
    /* gone */
  }
}
// pal-session.instructions.md is written by LoadContext (not a semi-static source)
try {
  unlinkSync(resolve(COPILOT_DIR, "instructions", "pal-session.instructions.md"));
} catch {
  /* gone */
}
log.success("Removed ~/.copilot/instructions/pal-*.instructions.md");

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
