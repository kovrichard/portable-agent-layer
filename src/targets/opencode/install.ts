/**
 * PAL — opencode target installer (TypeScript)
 * Deploys plugin, installs skills, generates AGENTS.md.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { palPkg, platform } from "../../hooks/lib/paths";
import { getSemiStaticSources } from "../../hooks/lib/semi-static";
import { copyAgentsForOpencode, copySkills, countSkills, log, writeJson } from "../lib";
import { allowPalHome, palHomePattern } from "./permission";

const PKG_ROOT = palPkg();
const OC_GLOBAL_DIR = platform.opencodeDir();
const OC_PLUGINS_DIR = resolve(OC_GLOBAL_DIR, "plugins");

mkdirSync(OC_PLUGINS_DIR, { recursive: true });

const pluginSrc = resolve(PKG_ROOT, "src", "targets", "opencode", "plugin.ts");
const pluginDst = resolve(OC_PLUGINS_DIR, "pal-plugin.ts");
// Embed PKG_ROOT as a hardcoded constant so no env config is needed
const pluginContent = readFileSync(pluginSrc, "utf-8").replace(
  /const PAL_DIR = process\.env\.PAL_DIR \|\| resolve\(import\.meta\.dir, "\.\.\/\.\.\/\.\."\);/,
  `const PAL_DIR = ${JSON.stringify(PKG_ROOT)};`
);
writeFileSync(pluginDst, pluginContent, "utf-8");
log.success(`Deployed plugin to ${pluginDst}`);

const pkgPath = resolve(OC_PLUGINS_DIR, "package.json");
if (!existsSync(pkgPath)) {
  writeJson(pkgPath, { dependencies: { "@opencode-ai/plugin": "latest" } });
  log.info("Created package.json for plugin dependencies");
}

try {
  Bun.spawnSync(["bun", "install", "--silent"], { cwd: OC_PLUGINS_DIR });
} catch {
  log.warn(`Could not install plugin deps — run 'bun install' in ${OC_PLUGINS_DIR}`);
}

const claudeSkillsDir = resolve(platform.claudeDir(), "skills");
copySkills(claudeSkillsDir);

const ocAgentsDir = resolve(OC_GLOBAL_DIR, "agents");
const agentCount = copyAgentsForOpencode(ocAgentsDir);
log.success(`${countSkills()} skills · ${agentCount} agents → ~/.config/opencode/`);

const configPath = resolve(OC_GLOBAL_DIR, "config.json");
const staticFiles = getSemiStaticSources().map((s) => s.path);
let ocConfig: Record<string, unknown> = {};
if (existsSync(configPath) && statSync(configPath).size > 0) {
  try {
    ocConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    /* start fresh */
  }
}
const existingInstructions = Array.isArray(ocConfig.instructions)
  ? (ocConfig.instructions as string[])
  : [];
ocConfig.instructions = [...new Set([...existingInstructions, ...staticFiles])];
ocConfig = allowPalHome(ocConfig, palHomePattern());
writeFileSync(configPath, `${JSON.stringify(ocConfig, null, 2)}\n`, "utf-8");
