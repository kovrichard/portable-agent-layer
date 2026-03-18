/**
 * PAI — opencode uninstaller (TypeScript)
 * Removes plugin and AGENTS.md.
 */

import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { log, removeSkills } from "../lib";

const PAI_DIR = resolve(import.meta.dir, "..", "..");
const OC_GLOBAL_DIR = resolve(process.env.HOME!, ".config", "opencode");

// --- Remove plugin ---
const pluginPath = resolve(OC_GLOBAL_DIR, "plugins", "pai-plugin.ts");
try { unlinkSync(pluginPath); log.success("Removed PAI plugin"); } catch { log.info("No PAI plugin found"); }

// --- Remove skills ---
const removed = removeSkills(PAI_DIR, resolve(process.env.HOME!, ".claude", "skills"));
if (removed.length > 0) log.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);

// --- Remove AGENTS.md and ~/.claude/CLAUDE.md symlink ---
const agentsMd = resolve(OC_GLOBAL_DIR, "AGENTS.md");
const claudeMd = resolve(process.env.HOME!, ".claude", "CLAUDE.md");
try { unlinkSync(claudeMd); log.success("Removed ~/.claude/CLAUDE.md"); } catch { /* gone */ }
try { unlinkSync(agentsMd); log.success("Removed ~/.config/opencode/AGENTS.md"); } catch { /* gone */ }

log.success("opencode uninstall complete");
