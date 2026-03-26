/**
 * PAL — opencode target installer (TypeScript)
 * Deploys plugin, installs skills, generates AGENTS.md.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { regenerateIfNeeded } from "../../hooks/lib/claude-md";
import { palPkg, platform } from "../../hooks/lib/paths";
import {
  copyAgentsForOpencode,
  copyPalDocs,
  copySkills,
  countSkills,
  generateSkillIndex,
  log,
  writeJson,
} from "../lib";

const PKG_ROOT = palPkg();
const OC_GLOBAL_DIR = platform.opencodeDir();
const OC_PLUGINS_DIR = resolve(OC_GLOBAL_DIR, "plugins");

mkdirSync(OC_PLUGINS_DIR, { recursive: true });

// --- 1. Deploy plugin (clean up legacy filename) ---
const legacyPlugin = resolve(OC_PLUGINS_DIR, "pai-plugin.ts");
if (existsSync(legacyPlugin)) {
  unlinkSync(legacyPlugin);
}
const pluginSrc = resolve(PKG_ROOT, "src", "targets", "opencode", "plugin.ts");
const pluginDst = resolve(OC_PLUGINS_DIR, "pal-plugin.ts");
// Embed PKG_ROOT as a hardcoded constant so no env config is needed
const pluginContent = readFileSync(pluginSrc, "utf-8").replace(
  /const PAL_DIR = process\.env\.PAL_DIR \|\| resolve\(import\.meta\.dir, "\.\.\/\.\.\/\.\."\);/,
  `const PAL_DIR = ${JSON.stringify(PKG_ROOT)};`
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
const claudeSkillsDir = resolve(platform.claudeDir(), "skills");
copySkills(claudeSkillsDir);
generateSkillIndex();
log.success("Installed skills to ~/.agents/skills/");

// --- 4. Install agents into ~/.config/opencode/agents/ ---
const ocAgentsDir = resolve(OC_GLOBAL_DIR, "agents");
copyAgentsForOpencode(ocAgentsDir);

// --- 5. Copy PAL system docs ---
const palDocsCount = copyPalDocs();
log.success(`Installed ${palDocsCount} PAL docs to ~/.agents/PAL/`);

// --- 6. Generate ~/.config/opencode/AGENTS.md ---
regenerateIfNeeded();
log.success("Generated ~/.config/opencode/AGENTS.md");

log.success("opencode installation complete");
console.log("");
log.info(`Plugin: ${pluginDst}`);
log.info(`Skills: ${countSkills()} (native via ~/.agents/skills/)`);
