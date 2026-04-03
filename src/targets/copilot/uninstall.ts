/**
 * PAL — Copilot uninstaller
 * Removes pal-hooks.json, skill symlinks, agents, and copilot-instructions.md symlink.
 */

import { copyFileSync, existsSync, lstatSync, readlinkSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { platform } from "../../hooks/lib/paths";
import { log, removeAgentsFromCopilot, removePalDocs, removeSkills } from "../lib";

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

// --- Remove copilot-instructions.md symlink (only if it points to AGENTS.md) ---
const instructionsPath = resolve(COPILOT_DIR, "copilot-instructions.md");
if (existsSync(instructionsPath)) {
  try {
    const stat = lstatSync(instructionsPath);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(instructionsPath);
      if (target.includes("AGENTS.md")) {
        unlinkSync(instructionsPath);
        log.success("Removed copilot-instructions.md symlink");
      } else {
        log.info("copilot-instructions.md is not a PAL symlink — leaving it");
      }
    }
  } catch {
    // ignore
  }
}

// --- Remove PAL docs ---
removePalDocs();

log.success("Copilot uninstall complete");
