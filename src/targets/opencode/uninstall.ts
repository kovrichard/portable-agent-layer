/**
 * PAL — opencode uninstaller (TypeScript)
 * Removes plugin, AGENTS.md, and PAL entries from config.json.
 */

import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { palHome, platform } from "../../hooks/lib/paths";
import { log, removeAgentsFromOpencode, removePalDocs, removeSkills } from "../lib";

const OC_GLOBAL_DIR = platform.opencodeDir() || "";

const PAL_CLAUDE_DIR = platform.claudeDir() || "";

if (!OC_GLOBAL_DIR || !PAL_CLAUDE_DIR) {
  log.error("PAL_OPENCODE_DIR or PAL_CLAUDE_DIR not set");
  process.exit(1);
}

// --- Remove plugin ---
const pluginPath = resolve(OC_GLOBAL_DIR, "plugins", "pal-plugin.ts");
try {
  unlinkSync(pluginPath);
  log.success("Removed PAL plugin");
} catch {
  log.info("No PAL plugin found");
}

// --- Remove skills ---
const removed = removeSkills(resolve(PAL_CLAUDE_DIR, "skills"));
if (removed.length > 0)
  log.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);

// --- Remove agents ---
const removedAgents = removeAgentsFromOpencode(resolve(OC_GLOBAL_DIR, "agents"));
if (removedAgents.length > 0)
  log.success(
    `Removed ${removedAgents.length} opencode agent(s): ${removedAgents.join(", ")}`
  );

// --- Remove PAL system docs ---
removePalDocs();

// --- Remove AGENTS.md and CLAUDE.md ---
const agentsMd = resolve(OC_GLOBAL_DIR, "AGENTS.md");
const claudeMd = resolve(PAL_CLAUDE_DIR, "CLAUDE.md");
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

// --- Remove PAL entries from config.json instructions[] ---
const configPath = resolve(OC_GLOBAL_DIR, "config.json");
if (existsSync(configPath) && statSync(configPath).size > 0) {
  try {
    const ocConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    if (Array.isArray(ocConfig.instructions)) {
      const memory = resolve(palHome(), "memory");
      const palFiles = new Set([
        resolve(memory, "self-model", "current.md"),
        resolve(memory, "wisdom", "context.md"),
        resolve(memory, "relationship", "opinions-context.md"),
        resolve(memory, "learning", "synthesis-digest.md"),
        resolve(palHome(), "docs", "STEERING_RULES.md"),
      ]);
      const filtered = (ocConfig.instructions as string[]).filter(
        (p) => !palFiles.has(p)
      );
      if (filtered.length === 0) {
        delete ocConfig.instructions;
      } else {
        ocConfig.instructions = filtered;
      }
      writeFileSync(configPath, `${JSON.stringify(ocConfig, null, 2)}\n`, "utf-8");
      log.success("Removed PAL entries from config.json instructions[]");
    }
  } catch {
    log.warn("Could not clean config.json instructions[] — check manually");
  }
}

log.success("opencode uninstall complete");
