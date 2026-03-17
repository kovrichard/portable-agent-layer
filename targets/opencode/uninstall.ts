/**
 * PAI — opencode uninstaller (TypeScript)
 * Removes plugin, PAI section from instructions.md, and PAI_DIR env.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { log } from "../lib";

const OC_GLOBAL_DIR = resolve(process.env.HOME!, ".config", "opencode");

// --- Remove plugin ---
const pluginPath = resolve(OC_GLOBAL_DIR, "plugins", "pai-plugin.ts");
if (existsSync(pluginPath)) {
  unlinkSync(pluginPath);
  log.success("Removed PAI plugin");
} else {
  log.info("No PAI plugin found");
}

// --- Remove PAI section from instructions ---
const INSTRUCTIONS = resolve(OC_GLOBAL_DIR, "instructions.md");
const PAI_START = "<!-- PAI:START -->";
const PAI_END = "<!-- PAI:END -->";

if (existsSync(INSTRUCTIONS)) {
  const content = readFileSync(INSTRUCTIONS, "utf-8");
  if (content.includes(PAI_START)) {
    const cleaned = content
      .replace(new RegExp(`${PAI_START}[\\s\\S]*?${PAI_END}\n?`, "g"), "")
      .trimEnd();
    writeFileSync(INSTRUCTIONS, cleaned + (cleaned ? "\n" : ""), "utf-8");
    log.success("Removed PAI section from instructions.md");
  } else {
    log.info("No PAI section in instructions.md");
  }
}

log.success("opencode uninstall complete");
