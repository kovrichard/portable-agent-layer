/**
 * PAL — Antigravity CLI target installer
 * Everything PAL gives agy lives in one plugin, ~/.gemini/config/plugins/pal/,
 * so the user's own hooks.json and settings are never merged into.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { skillsDirOf } from "../../hooks/lib/agent-registry";
import { ensureAntigravityRule } from "../../hooks/lib/claude-md";
import { platform } from "../../hooks/lib/paths";
import { copySkills, countSkills, log, writeJson } from "../lib";

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

copySkills(skillsDirOf("antigravity"));
log.success(`${countSkills()} skills → ${skillsDirOf("antigravity")}`);
