/**
 * PAI — opencode target installer (TypeScript)
 * Deploys plugin, installs skills, generates AGENTS.md.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { regenerateIfNeeded } from "../../hooks/lib/claude-md";
import { copySkills, countSkills, log, writeJson } from "../lib";

const PAI_DIR = resolve(dirname(import.meta.dir), "..");
const OC_GLOBAL_DIR = process.env.PAI_OPENCODE_DIR!;
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

try {
  Bun.spawnSync(["bun", "install", "--silent"], { cwd: OC_PLUGINS_DIR });
  log.success("Installed plugin dependencies");
} catch {
  log.warn(`Could not install plugin deps — run 'bun install' in ${OC_PLUGINS_DIR}`);
}

// --- 3. Install skills into ~/.agents/skills/ ---
const claudeSkillsDir = resolve(process.env.PAI_CLAUDE_DIR!, "skills");
copySkills(PAI_DIR, claudeSkillsDir);
log.success("Installed skills to ~/.agents/skills/");

// --- 4. Generate ~/.config/opencode/AGENTS.md ---
regenerateIfNeeded();
log.success("Generated ~/.config/opencode/AGENTS.md");

log.success("opencode installation complete");
console.log("");
log.info(`Plugin: ${pluginDst}`);
log.info(`Skills: ${countSkills()} (native via ~/.agents/skills/)`);
