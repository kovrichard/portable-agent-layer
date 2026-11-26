import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";

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

/** Compared as paths, not strings — a separator differs by platform. */
export function isInside(parent: string, target: string): boolean {
  const rel = relative(parent, target);

  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** A direct entry of `parent`, not one nested deeper — compared as paths, like isInside. */
export function isDirectChild(parent: string, target: string): boolean {
  if (!isInside(parent, target)) return false;
  const rel = relative(parent, target);

  return basename(rel) === rel;
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
  return envPath("PAL_PKG", resolve(import.meta.dir, "..", ".."));
}

/**
 * Root of the user's personal state (telos, memory, docs, tools, skills).
 * Always resolves to ~/.pal/ regardless of where the package lives.
 * Power users who want memory/telos versioned in a repo can override via PAL_HOME.
 */
function sandboxPalHome(): string {
  const testRoot =
    process.env.PAL_TEST_ROOT ?? resolve(import.meta.dir, "..", "..", ".test");

  return resolve(testRoot, "pal-home");
}

function defaultPalHome(): string {
  if (process.env.PAL_TEST_SANDBOX) return sandboxPalHome();

  return resolve(homedir(), ".pal");
}

export function palHome(): string {
  return envPath("PAL_HOME", defaultPalHome());
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

/** The folders under the PAL home that hold the user's data, by kind: learned, recorded, work, machine state. */
const DATA_ROOTS = ["memory", "records", "work", "state"] as const;

const formerStateDir = () => home("memory", "state");

/**
 * This machine's working state. An install whose owner has not run the move to
 * `state/` yet keeps using `memory/state`; once `state/` exists it wins.
 */
export function stateDir(): string {
  const current = home("state");
  if (existsSync(current) || !existsSync(formerStateDir())) return current;

  return formerStateDir();
}

/** A file that left the state folder for `dir`: its old copy is read until the owner's move takes it. */
export function movedOutOfState(dir: string, name: string): string {
  const current = resolve(dir, name);
  const former = resolve(formerStateDir(), name);

  return existsSync(current) || !existsSync(former) ? current : former;
}

// User state paths (in PAL_HOME / repo root)
export const paths = {
  telos: () => home("telos"),
  memory: () => home("memory"),
  dataRoots: () => DATA_ROOTS.map((root) => home(root)),
  signals: () => ensureDir(home("memory", "signals")),
  state: () => ensureDir(stateDir()),
  formerState: formerStateDir,
  research: () => ensureDir(home("memory", "research")),
  wisdomState: () => ensureDir(home("memory", "wisdom", "state")),
  adaptation: () => ensureDir(home("memory", "adaptation")),
  knowledge: () => ensureDir(home("memory", "knowledge")),
  knowledgeDomain: (d: string) => ensureDir(home("memory", "knowledge", d)),
  failures: () => ensureDir(home("memory", "learning", "failures")),
  legacyProjects: () => resolve(formerStateDir(), "progress"),
  transcriptHandoff: () => ensureDir(resolve(stateDir(), "transcript-handoff")),
  backups: () => ensureDir(home("backups")),
  cache: () => ensureDir(home("cache")),
  debug: () => ensureDir(home("debug")),
  serverState: () => home("server.json"),
} as const;

// Platform directories (env override or cross-platform defaults)
const h = homedir();

const AGENT_DIR_DEFAULTS = {
  PAL_CLAUDE_DIR: [".claude"],
  PAL_OPENCODE_DIR: [".config", "opencode"],
  PAL_CURSOR_DIR: [".cursor"],
  PAL_COPILOT_DIR: [".copilot"],
  PAL_CODEX_DIR: [".codex"],
  PAL_GEMINI_DIR: [".gemini"],
  PAL_AGENTS_DIR: [".agents"],
} as const;

type AgentDirOverride = keyof typeof AGENT_DIR_DEFAULTS;

const defaultAgentDir = (env: AgentDirOverride) => resolve(h, ...AGENT_DIR_DEFAULTS[env]);

const agentDir = (env: AgentDirOverride) => () => envPath(env, defaultAgentDir(env));

/** Every agent dir override with the real directory it replaces. */
export function agentDirOverrides(): { env: AgentDirOverride; realDir: string }[] {
  return (Object.keys(AGENT_DIR_DEFAULTS) as AgentDirOverride[]).map((env) => ({
    env,
    realDir: defaultAgentDir(env),
  }));
}

const geminiDir = agentDir("PAL_GEMINI_DIR");

export const platform = {
  claudeDir: agentDir("PAL_CLAUDE_DIR"),
  opencodeDir: agentDir("PAL_OPENCODE_DIR"),
  cursorDir: agentDir("PAL_CURSOR_DIR"),
  copilotDir: agentDir("PAL_COPILOT_DIR"),
  codexDir: agentDir("PAL_CODEX_DIR"),
  antigravityPluginDir: () => resolve(geminiDir(), "config", "plugins", "pal"),
  antigravityCliDir: () => resolve(geminiDir(), "antigravity-cli"),
  antigravitySettings: () => resolve(geminiDir(), "antigravity-cli", "settings.json"),
  agentsDir: agentDir("PAL_AGENTS_DIR"),
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
  antigravityHooksTemplate: () => pkg("assets", "templates", "hooks.antigravity.json"),
  antigravitySettingsTemplate: () =>
    pkg("assets", "templates", "settings.antigravity.json"),
  codexRulesTemplate: () => pkg("assets", "templates", "rules.codex.rules"),
  statuslineScriptBash: () => pkg("assets", "statusline.sh"),
  statuslineScriptPs1: () => pkg("assets", "statusline.ps1"),
  agentTools: () => pkg("src", "tools", "agent"),
  tools: () => pkg("src", "tools"),
  palDocs: () => pkg("assets", "templates", "PAL"),
} as const;
