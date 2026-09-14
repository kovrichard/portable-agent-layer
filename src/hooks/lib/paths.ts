import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Turn a path string that came from outside — argv, a flag, an env override, a
 * persisted record — into a real absolute path.
 *
 * "~" is a shell feature, not a filesystem one: bash and zsh expand it before a
 * process starts, cmd.exe has no such feature, and PowerShell hands it to native
 * commands untouched. So node:path has nothing for it (`resolve("~/x")` yields
 * `<cwd>/~/x`) and every caller that skips this function is a Windows bug.
 *
 * Only the leading segment counts. `~user` throws instead of resolving, because
 * it needs a passwd lookup and quietly reading it as a relative directory is the
 * exact failure this replaces.
 */
export function toPath(input: string, base: string = process.cwd()): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return resolve(homedir(), input.slice(2));
  }
  if (input.startsWith("~")) {
    throw new Error(`Home-relative paths for another user are not supported: ${input}`);
  }
  return resolve(base, input);
}

/**
 * Whether a string names a location rather than a bare identifier. A verb that
 * accepts either `my-skill` or `~/skills/my-skill` has to tell them apart before
 * it looks the argument up in a store — appending a tilde path to a store
 * directory yields a path that can never exist.
 */
export function namesAPath(input: string): boolean {
  return input.startsWith("~") || input.includes("/") || input.includes("\\");
}

/** An env override names a path the same way a flag does, so it gets the same treatment. */
function envPath(name: string, fallback: string): string {
  const override = process.env[name];
  return override ? toPath(override) : fallback;
}

/**
 * Root of the PAL package (engine code + shipped assets).
 * In repo mode: the repo root.
 * In package mode: the global node_modules package directory.
 */
export function palPkg(): string {
  return envPath("PAL_PKG", resolve(import.meta.dir, "..", "..", ".."));
}

/**
 * Root of the user's personal state (telos, memory, docs, tools, skills).
 * Always resolves to ~/.pal/ regardless of where the package lives.
 * Power users who want memory/telos versioned in a repo can override via PAL_HOME.
 */
export function palHome(): string {
  return envPath("PAL_HOME", resolve(homedir(), ".pal"));
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
  knowledge: () => ensureDir(home("memory", "knowledge")),
  knowledgeDomain: (d: string) => ensureDir(home("memory", "knowledge", d)),
  failures: () => ensureDir(home("memory", "learning", "failures")),
  reflections: () => ensureDir(home("memory", "learning", "reflections")),
  reflectionsFile: () =>
    home("memory", "learning", "reflections", "algorithm-reflections.jsonl"),
  retrievalIndex: () => home("memory", "learning", ".retrieval-index.json"),
  ledger: () => ensureDir(home("memory", "ledger")),
  progress: () => ensureDir(home("memory", "state", "progress")),
  projectHistory: () => ensureDir(home("memory", "projects")),
  unboundHistory: () => ensureDir(home("memory", "state", "unbound-history")),
  sessionLearning: () => ensureDir(home("memory", "learning", "session")),
  synthesis: () => ensureDir(home("memory", "learning", "synthesis")),
  work: () => ensureDir(home("memory", "work")),
  backups: () => ensureDir(home("backups")),
  debug: () => ensureDir(home("debug")),
  serverState: () => home("server.json"),
} as const;

// Platform directories (env override or cross-platform defaults)
const h = homedir();
export const platform = {
  claudeDir: () => envPath("PAL_CLAUDE_DIR", resolve(h, ".claude")),
  opencodeDir: () => envPath("PAL_OPENCODE_DIR", resolve(h, ".config", "opencode")),
  cursorDir: () => envPath("PAL_CURSOR_DIR", resolve(h, ".cursor")),
  copilotDir: () => envPath("PAL_COPILOT_DIR", resolve(h, ".copilot")),
  codexDir: () => envPath("PAL_CODEX_DIR", resolve(h, ".codex")),
  agentsDir: () => envPath("PAL_AGENTS_DIR", resolve(h, ".agents")),
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
  codexRulesTemplate: () => pkg("assets", "templates", "rules.codex.rules"),
  statuslineScriptBash: () => pkg("assets", "statusline.sh"),
  statuslineScriptPs1: () => pkg("assets", "statusline.ps1"),
  agentTools: () => pkg("src", "tools", "agent"),
  tools: () => pkg("src", "tools"),
  palDocs: () => pkg("assets", "templates", "PAL"),
} as const;
