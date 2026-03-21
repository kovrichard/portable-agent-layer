/**
 * PAI — opencode uninstaller (TypeScript)
 * Removes plugin and AGENTS.md.
 */

import { unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { log, removeAgentsFromOpencode, removeSkills } from "../lib";

const OC_GLOBAL_DIR = process.env.PAI_OPENCODE_DIR || "";

const PAI_CLAUDE_DIR = process.env.PAI_CLAUDE_DIR || "";

if (!OC_GLOBAL_DIR || !PAI_CLAUDE_DIR) {
  log.error("PAI_OPENCODE_DIR or PAI_CLAUDE_DIR not set");
  process.exit(1);
}

// --- Remove plugin ---
const pluginPath = resolve(OC_GLOBAL_DIR, "plugins", "pai-plugin.ts");
try {
  unlinkSync(pluginPath);
  log.success("Removed PAI plugin");
} catch {
  log.info("No PAI plugin found");
}

// --- Remove skills ---
const removed = removeSkills(resolve(PAI_CLAUDE_DIR, "skills"));
if (removed.length > 0)
  log.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);

// --- Remove agents ---
const removedAgents = removeAgentsFromOpencode(resolve(OC_GLOBAL_DIR, "agents"));
if (removedAgents.length > 0)
  log.success(
    `Removed ${removedAgents.length} opencode agent(s): ${removedAgents.join(", ")}`
  );

// --- Remove AGENTS.md and CLAUDE.md symlink ---
const agentsMd = resolve(OC_GLOBAL_DIR, "AGENTS.md");
const claudeMd = resolve(PAI_CLAUDE_DIR, "CLAUDE.md");
try {
  unlinkSync(claudeMd);
  log.success("Removed ~/.claude/CLAUDE.md");
} catch {
  /* gone */
}
try {
  unlinkSync(agentsMd);
  log.success("Removed ~/.config/opencode/AGENTS.md");
} catch {
  /* gone */
}

log.success("opencode uninstall complete");
