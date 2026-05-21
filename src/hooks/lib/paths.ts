import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Root of the PAL package (engine code + shipped assets).
 * In repo mode: the repo root.
 * In package mode: the global node_modules package directory.
 */
export function palPkg(): string {
  return process.env.PAL_PKG || resolve(import.meta.dir, "..", "..", "..");
}

/**
 * Root of the user's personal state (telos, memory, docs, tools, skills).
 * Always resolves to ~/.pal/ regardless of where the package lives.
 * Power users who want memory/telos versioned in a repo can override via PAL_HOME.
 */
export function palHome(): string {
  return process.env.PAL_HOME || resolve(homedir(), ".pal");
}

/** Ensure a directory exists, creating it recursively if needed */
export function ensureDir(path: string): string {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  return path;
}

/** Resolve a path relative to the user's home */
function home(...segments: string[]): string {
  return resolve(palHome(), ...segments);
}

/** Resolve a path relative to the package root */
function pkg(...segments: string[]): string {
  return resolve(palPkg(), ...segments);
}

// User state paths (in PAL_HOME / repo root)
export const paths = {
  telos: () => home("telos"),
  memory: () => home("memory"),
  learning: () => ensureDir(home("memory", "learning")),
  signals: () => ensureDir(home("memory", "signals")),
  state: () => ensureDir(home("memory", "state")),
  research: () => ensureDir(home("memory", "research")),
  wisdom: () => ensureDir(home("memory", "wisdom", "frames")),
  wisdomState: () => ensureDir(home("memory", "wisdom", "state")),
  relationship: () => ensureDir(home("memory", "relationship")),
  entities: () => ensureDir(home("memory", "entities")),
  knowledge: () => ensureDir(home("memory", "knowledge")),
  knowledgeDomain: (d: string) => ensureDir(home("memory", "knowledge", d)),
  failures: () => ensureDir(home("memory", "learning", "failures")),
  retrievalIndex: () => home("memory", "learning", ".retrieval-index.json"),
  progress: () => ensureDir(home("memory", "state", "progress")),
  projectHistory: () => ensureDir(home("memory", "projects")),
  sessionLearning: () => ensureDir(home("memory", "learning", "session")),
  synthesis: () => ensureDir(home("memory", "learning", "synthesis")),
  work: () => ensureDir(home("memory", "work")),
  backups: () => ensureDir(home("backups")),
} as const;

// Platform directories (env override or cross-platform defaults)
const h = homedir();
export const platform = {
  claudeDir: () => process.env.PAL_CLAUDE_DIR || resolve(h, ".claude"),
  opencodeDir: () => process.env.PAL_OPENCODE_DIR || resolve(h, ".config", "opencode"),
  cursorDir: () => process.env.PAL_CURSOR_DIR || resolve(h, ".cursor"),
  copilotDir: () => process.env.PAL_COPILOT_DIR || resolve(h, ".copilot"),
  codexDir: () => process.env.PAL_CODEX_DIR || resolve(h, ".codex"),
  agentsDir: () => process.env.PAL_AGENTS_DIR || resolve(h, ".agents"),
} as const;

// Engine/asset paths (in PAL_PKG / repo root)
export const assets = {
  skills: () => pkg("assets", "skills"),
  agents: () => pkg("assets", "agents"),
  hooks: () => pkg("src", "hooks"),
  telosTemplates: () => pkg("assets", "templates", "telos"),
  agentsMdTemplate: () => pkg("assets", "templates", "AGENTS.md.template"),
  claudeSettingsTemplate: () => pkg("assets", "templates", "settings.claude.json"),
  cursorHooksTemplate: () => pkg("assets", "templates", "hooks.cursor.json"),
  copilotHooksTemplate: () => pkg("assets", "templates", "hooks.copilot.json"),
  codexHooksTemplate: () => pkg("assets", "templates", "hooks.codex.json"),
  agentTools: () => pkg("src", "tools", "agent"),
  palDocs: () => pkg("assets", "templates", "PAL"),
} as const;
