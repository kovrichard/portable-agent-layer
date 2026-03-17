/**
 * PAI — opencode target installer (TypeScript)
 * Deploys plugin, injects TELOS into instructions.md, sets PAI_DIR env.
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { log, readJson, writeJson, countMd, readSkillField, skillBody } from "../lib";
import { loadTelos } from "../../hooks/lib/context";
import { readSetupState, buildSetupPrompt } from "../../hooks/lib/setup";

const PAI_DIR = resolve(dirname(import.meta.dir), "..");
const OC_GLOBAL_DIR = resolve(process.env.HOME!, ".config", "opencode");
const OC_PLUGINS_DIR = resolve(OC_GLOBAL_DIR, "plugins");

mkdirSync(OC_PLUGINS_DIR, { recursive: true });

// --- 1. Deploy plugin ---
const pluginSrc = resolve(PAI_DIR, "targets", "opencode", "plugin.ts");
const pluginDst = resolve(OC_PLUGINS_DIR, "pai-plugin.ts");
const pluginContent = `// PAI_DIR=${PAI_DIR}\n` + readFileSync(pluginSrc, "utf-8");
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

// --- 3. Build instructions section ---
const INSTRUCTIONS = resolve(OC_GLOBAL_DIR, "instructions.md");
const PAI_START = "<!-- PAI:START -->";
const PAI_END = "<!-- PAI:END -->";

let existing = existsSync(INSTRUCTIONS) ? readFileSync(INSTRUCTIONS, "utf-8") : "";

// Remove existing PAI section if present
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

const skillsDir = resolve(PAI_DIR, "skills");
const skillFiles = existsSync(skillsDir)
  ? Bun.Glob ? [...new Bun.Glob("*.md").scanSync(skillsDir)] : []
  : [];

// Import readdirSync for skill listing
const { readdirSync } = await import("fs");
const skills = existsSync(skillsDir)
  ? readdirSync(skillsDir).filter((f: string) => f.endsWith(".md"))
  : [];

const paiSection = [
  PAI_START,
  "# Personal Context (TELOS)",
  "",
  ...(setupPrompt ? [setupPrompt, ""] : []),
  ...(telos ? [telos, ""] : []),
  "# Available Skills",
  "",
  ...skills.map((f: string) => {
    const p = resolve(skillsDir, f);
    const name = readSkillField(p, "name");
    const desc = readSkillField(p, "description");
    return `- **/${name}** — ${desc}`;
  }),
  "",
  ...skills.flatMap((f: string) => ["---", "", skillBody(resolve(skillsDir, f)), ""]),
  PAI_END,
].join("\n");

writeFileSync(INSTRUCTIONS, (existing ? existing + "\n\n" : "") + paiSection + "\n", "utf-8");
log.success("Added TELOS + skills to instructions.md");

// --- 4. Set PAI_DIR in opencode config ---
const OC_CONFIG = resolve(OC_GLOBAL_DIR, "config.json");
const config = readJson(OC_CONFIG, {} as Record<string, unknown>);
if (!config.env) config.env = {};
(config.env as Record<string, string>).PAI_DIR = PAI_DIR;
writeJson(OC_CONFIG, config);
log.info("Set PAI_DIR in opencode config");

log.success("opencode installation complete");
console.log("");
log.info(`Plugin: ${pluginDst}`);
log.info(`Instructions: ${INSTRUCTIONS}`);
log.info(`Skills: ${skills.length} (embedded in instructions)`);
