/**
 * PAL — Antigravity CLI target installer
 * Rules, hooks, skills and subagents live in one plugin, ~/.gemini/config/plugins/pal/.
 * A plugin cannot carry permissions, so the command allowlist alone is merged into
 * agy's settings.json; the user's own hooks.json is never touched.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { skillsDirOf } from "../../hooks/lib/agent-registry";
import { ensureAntigravityRule } from "../../hooks/lib/claude-md";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  copyAgentsForAntigravity,
  copySkills,
  countSkills,
  loadHooksTemplate,
  loadSettingsTemplate,
  log,
  mergeSettings,
  nativeAgentsDir,
  readJson,
  writeJson,
} from "../lib";

const PLUGIN_DIR = platform.antigravityPluginDir();

mkdirSync(PLUGIN_DIR, { recursive: true });
writeJson(resolve(PLUGIN_DIR, "plugin.json"), {
  name: "pal",
  description: "Portable Agent Layer — personal context, skills and hooks",
});
log.success(`PAL plugin → ${PLUGIN_DIR}`);

ensureAntigravityRule();
log.success(
  "PAL instructions → rules/pal.md (context rules follow from the shared digests)"
);

const PKG_ROOT = palPkg().replaceAll("\\", "/");
writeJson(
  resolve(PLUGIN_DIR, "hooks.json"),
  loadHooksTemplate(assets.antigravityHooksTemplate(), PKG_ROOT, "Antigravity CLI")
);
log.success("PAL hooks → hooks.json");

const SETTINGS = platform.antigravitySettings();
mkdirSync(dirname(SETTINGS), { recursive: true });
if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.bak.${Date.now()}`);
writeJson(
  SETTINGS,
  mergeSettings(
    readJson(SETTINGS, {}),
    loadSettingsTemplate(assets.antigravitySettingsTemplate(), PKG_ROOT)
  )
);
log.success("PAL command allowlist → antigravity-cli/settings.json");

copySkills(skillsDirOf("antigravity"));
const agentCount = copyAgentsForAntigravity(nativeAgentsDir("antigravity"));
log.success(`${countSkills()} skills · ${agentCount} agents → ${PLUGIN_DIR}`);
