/**
 * PAL — Antigravity CLI uninstaller
 * Removes the PAL plugin, ~/.gemini/config/plugins/pal/. Skill links are
 * unlinked first so removing the folder never walks into the skills they point at.
 */

import { existsSync, lstatSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { skillsDirOf } from "../../hooks/lib/agent-registry";
import { platform } from "../../hooks/lib/paths";
import { log } from "../lib";

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
  log.info("No PAL plugin found, nothing to do");
}
