/**
 * PAI — Claude Code target installer (TypeScript)
 * Merges hooks into existing settings.json (never overwrites).
 * Copies skills additively. Generates CLAUDE.md from TELOS.
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync, unlinkSync, lstatSync } from "fs";
import { resolve, dirname } from "path";
import { log, readJson, writeJson, copySkills, countSkills, countMd } from "../lib";
import { buildClaudeMd } from "../../hooks/lib/claude-md";

const PAI_DIR = resolve(dirname(import.meta.dir), "..");
const CLAUDE_DIR = resolve(process.env.HOME!, ".claude");
const SETTINGS = resolve(CLAUDE_DIR, "settings.json");

// --- Ensure settings.json exists ---
mkdirSync(CLAUDE_DIR, { recursive: true });
if (!existsSync(SETTINGS)) {
  writeFileSync(SETTINGS, "{}\n", "utf-8");
  log.info("Created new settings.json");
}

// --- Backup ---
const backup = `${SETTINGS}.bak.${Date.now()}`;
copyFileSync(SETTINGS, backup);
log.info("Backed up settings.json");

// --- Build hooks payload ---
const hooksPayload = {
  hooks: {
    SessionStart: [
      {
        matcher: "",
        hooks: [{ type: "command", command: `bun run ${PAI_DIR}/hooks/LoadContext.ts` }],
      },
    ],
    UserPromptSubmit: [
      {
        matcher: "",
        hooks: [{ type: "command", command: `bun run ${PAI_DIR}/hooks/UserPromptOrchestrator.ts` }],
      },
    ],
    PreToolUse: [
      {
        matcher: "Bash|Write|Edit",
        hooks: [{ type: "command", command: `bun run ${PAI_DIR}/hooks/SecurityValidator.ts` }],
      },
    ],
    Stop: [
      {
        matcher: "",
        hooks: [{ type: "command", command: `bun run ${PAI_DIR}/hooks/StopOrchestrator.ts` }],
      },
    ],
  },
};

// --- Merge hooks additively (deduplicate by command) ---
type HookEntry = { matcher: string; hooks: Array<{ type: string; command: string }> };
type Settings = { hooks?: Record<string, HookEntry[]>; env?: Record<string, string> };

const settings = readJson<Settings>(SETTINGS, {});
if (!settings.hooks) settings.hooks = {};

for (const [event, entries] of Object.entries(hooksPayload.hooks)) {
  const existing = settings.hooks[event] ?? [];
  for (const entry of entries) {
    const cmd = entry.hooks[0]?.command;
    const alreadyPresent = existing.some((e) => e.hooks?.[0]?.command === cmd);
    if (!alreadyPresent) existing.push(entry);
  }
  settings.hooks[event] = existing;
}

// --- Set env ---
if (!settings.env) settings.env = {};
settings.env.PAI_DIR = PAI_DIR;

writeJson(SETTINGS, settings);
log.success("Merged hooks into settings.json");

// --- Copy skills ---
const skillsDir = resolve(CLAUDE_DIR, "skills");
copySkills(PAI_DIR, skillsDir);

// --- Generate AGENTS.md and symlink CLAUDE.md → AGENTS.md ---
writeFileSync(resolve(PAI_DIR, "AGENTS.md"), buildClaudeMd(), "utf-8");
const symlinkPath = resolve(PAI_DIR, "CLAUDE.md");
try {
  const stat = lstatSync(symlinkPath);
  if (!stat.isSymbolicLink()) unlinkSync(symlinkPath);
} catch { /* doesn't exist */ }
try { symlinkSync("AGENTS.md", symlinkPath); } catch { /* already a symlink */ }
log.success("Generated AGENTS.md (CLAUDE.md → symlink)");

log.success("Claude Code installation complete");
console.log("");
log.info(`Hooks: 4 (SessionStart, UserPromptSubmit, PreToolUse, Stop)`);
log.info(`Skills: ${countSkills()}`);
log.info(`TELOS: ${countMd(resolve(PAI_DIR, "telos"))} files`);
