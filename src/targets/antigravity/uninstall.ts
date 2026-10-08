/**
 * PAL — Antigravity CLI uninstaller
 * Removes the PAL plugin, ~/.gemini/config/plugins/pal/, exactly the allowlist
 * entries PAL merged into agy's settings.json, and PAL's statusLine and script. Skill links are unlinked first so
 * removing the folder never walks into the skills they point at.
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { skillsDirOf } from "../../hooks/lib/agent-registry";
import { assets, palPkg, platform } from "../../hooks/lib/paths";
import {
  loadSettingsTemplate,
  log,
  readJson,
  removeStatusline,
  removeStatuslineConfig,
  unmergeSettings,
  writeJson,
} from "../lib";

function unlinkSkillLinks(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const links = readdirSync(dir).filter((name) =>
    lstatSync(resolve(dir, name)).isSymbolicLink()
  );
  for (const name of links) unlinkSync(resolve(dir, name));
  return links;
}

const PLUGIN_DIR = platform.antigravityPluginDir();

if (existsSync(PLUGIN_DIR)) {
  const removed = unlinkSkillLinks(skillsDirOf("antigravity"));
  rmSync(PLUGIN_DIR, { recursive: true, force: true });
  log.success(`Removed the PAL plugin and ${removed.length} skill link(s)`);
} else {
  log.info("No PAL plugin found");
}

const SETTINGS = platform.antigravitySettings();
if (existsSync(SETTINGS)) {
  copyFileSync(SETTINGS, `${SETTINGS}.bak.${Date.now()}`);
  const template = loadSettingsTemplate(
    assets.antigravitySettingsTemplate(),
    palPkg().replaceAll("\\", "/")
  );
  writeJson(
    SETTINGS,
    removeStatuslineConfig(
      unmergeSettings(readJson(SETTINGS, {}), template),
      "antigravity"
    )
  );
  log.success(
    "Removed the PAL command allowlist and statusLine from antigravity-cli/settings.json"
  );
}
removeStatusline("antigravity");
