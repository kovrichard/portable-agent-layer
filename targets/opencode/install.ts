/**
 * PAI — opencode target installer (TypeScript)
 * Deploys plugin, injects TELOS into instructions.md, sets PAI_DIR env.
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { log, writeJson, copySkills, countSkills } from "../lib";
import { loadTelos } from "../../hooks/lib/context";
import { readSetupState, buildSetupPrompt } from "../../hooks/lib/setup";

const PAI_DIR = resolve(dirname(import.meta.dir), "..");
const OC_GLOBAL_DIR = resolve(process.env.HOME!, ".config", "opencode");
const OC_PLUGINS_DIR = resolve(OC_GLOBAL_DIR, "plugins");

mkdirSync(OC_PLUGINS_DIR, { recursive: true });

// --- 1. Deploy plugin ---
const pluginSrc = resolve(PAI_DIR, "targets", "opencode", "plugin.ts");
const pluginDst = resolve(OC_PLUGINS_DIR, "pai-plugin.ts");
// Embed PAI_DIR as a hardcoded constant so no env config is needed
const pluginContent = readFileSync(pluginSrc, "utf-8").replace(
  /const PAI_DIR = process\.env\.PAI_DIR \|\| resolve\(import\.meta\.dir, "\.\.\/\.\."\);/,
  `const PAI_DIR = ${JSON.stringify(PAI_DIR)};`
);
writeFileSync(pluginDst, pluginContent, "utf-8");
log.success(`Deployed plugin to ${pluginDst}`);

// --- 2. Ensure package.json for plugin deps ---
const pkgPath = resolve(OC_PLUGINS_DIR, "package.json");
if (!existsSync(pkgPath)) {
  writeJson(pkgPath, { dependencies: { "@opencode-ai/plugin": "latest" } });
  log.info("Created package.json for plugin dependencies");
}

// Install deps
try {
  Bun.spawnSync(["bun", "install", "--silent"], { cwd: OC_PLUGINS_DIR });
  log.success("Installed plugin dependencies");
} catch {
  log.warn("Could not install plugin deps — run 'bun install' in " + OC_PLUGINS_DIR);
}

// --- 3. Install skills into ~/.agents/skills/ ---
const claudeSkillsDir = resolve(process.env.HOME!, ".claude", "skills");
copySkills(PAI_DIR, claudeSkillsDir);
log.success("Installed skills to ~/.agents/skills/");

// --- 4. Build instructions section (TELOS only — skills are native via ~/.agents/skills/) ---
const INSTRUCTIONS = resolve(OC_GLOBAL_DIR, "instructions.md");
const PAI_START = "<!-- PAI:START -->";
const PAI_END = "<!-- PAI:END -->";

let existing = existsSync(INSTRUCTIONS) ? readFileSync(INSTRUCTIONS, "utf-8") : "";

if (existing.includes(PAI_START)) {
  existing = existing.replace(
    new RegExp(`${PAI_START}[\\s\\S]*?${PAI_END}\n?`, "g"),
    ""
  ).trimEnd();
  log.info("Replacing existing PAI section in instructions.md");
}

const state = readSetupState();
const setupPrompt = state ? buildSetupPrompt(state) : null;
const telos = loadTelos();

const paiSection = [
  PAI_START,
  "# Personal Context (TELOS)",
  "",
  ...(setupPrompt ? [setupPrompt, ""] : []),
  ...(telos ? [telos, ""] : []),
  PAI_END,
].join("\n");

writeFileSync(INSTRUCTIONS, (existing ? existing + "\n\n" : "") + paiSection + "\n", "utf-8");
log.success("Added TELOS to instructions.md");

log.success("opencode installation complete");
console.log("");
log.info(`Plugin: ${pluginDst}`);
log.info(`Instructions: ${INSTRUCTIONS}`);
log.info(`Skills: ${countSkills()} (native via ~/.agents/skills/`);
