/**
 * Shared security definitions and validation logic.
 * Used by SecurityValidator.ts (Claude Code) and the opencode plugin.
 */

/** Dangerous command patterns — always blocked */
export const BLOCKED_COMMANDS: [RegExp, string][] = [
  [/rm\s+-rf\s+[/~]/, "Recursive delete of root or home"],
  [/mkfs\./, "Filesystem format"],
  [/dd\s+if=.*of=\/dev\//, "Raw disk write"],
  [/>\s*\/dev\/sd/, "Direct device write"],
  [/chmod\s+-R\s+777\s+\//, "Recursive world-writable root"],
  [/:\(\)\{\s*:\|:&\s*\};:/, "Fork bomb"],
  [/curl.*\|\s*(?:ba)?sh/, "Pipe to shell"],
  [/wget.*\|\s*(?:ba)?sh/, "Pipe to shell"],
];

/** Hook-managed files — single source of truth */
export const HOOK_MANAGED_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  "ratings.jsonl",
  "sessions.json",
  "captured-learnings.json",
  "counts.json",
  "session-names.json",
  "debug.log",
  "last-responses.json",
  "signal-cache.json",
  "pending-failure.json",
  "token-usage.jsonl",
  "graduated.json",
  "update-available.json",
  "debug.log.prev",
  "opinions.json",
  "pal-settings.json",
  "skill-index.json",
  "algorithm-reflections.jsonl",
  ".retrieval-index.json",
];

/** Hook-managed directories — AI must not write to or delete from these */
export const HOOK_MANAGED_DIRS = [
  "memory/signals",
  "memory/learning/failures",
  "memory/learning/session",
  "memory/learning/synthesis",
  "memory/relationship",
  "memory/wisdom/state",
  "memory/projects",
  "memory/state/progress",
];

/** Escape a string for use in a RegExp */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Paths that should never be written to */
export const PROTECTED_PATHS: RegExp[] = [
  /^\/etc\//,
  /^\/boot\//,
  /^\/System\//,
  /\.ssh\/(?!config)/,
  /\.gnupg\//,
  // Claude Code auto-memory — PAL owns memory; writes here indicate wrong system is being used
  /\.claude\/projects\/[^/]+\/memory\//,
  // PAL-deployed dirs — engine-managed, overwritten on every `pal install`
  /[/\\]\.pal[/\\](?:docs|skills|tools)[/\\]/,
  // Derived from HOOK_MANAGED_FILES — scoped to managed roots only
  ...HOOK_MANAGED_FILES.map(
    (name) =>
      new RegExp(`[/\\\\]\\.(?:pal|claude|agents|cursor)[/\\\\].*${escapeRegExp(name)}$`)
  ),
];

/** Patterns that warrant a warning (logged but not blocked) */
export const WARN_COMMANDS: RegExp[] = [
  /git\s+push\s+.*--force/,
  /git\s+reset\s+--hard/,
  /drop\s+(?:table|database)/i,
  /truncate\s+table/i,
];

/** Roots where managed files/dirs are protected (user state, not repo templates) */
const MANAGED_ROOTS = [".pal/", ".claude/", ".agents/", ".config/opencode/", ".cursor/"];

function isUnderManagedRoot(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return MANAGED_ROOTS.some(
    (root) => normalized.includes(`/${root}`) || normalized.includes(`\\.${root}`)
  );
}

/** Read-only commands allowed to reference protected files */
const READ_ONLY_COMMANDS =
  /^\s*(?:cat|head|tail|less|more|grep|rg|wc|diff|stat|file|ls|dir|find|git\s+(?:log|diff|blame|show|status)|bat)\b/;

/** Check a bash command against blocked patterns. Returns reason string or null. */
export function checkBashCommand(cmd: string): string | null {
  for (const [pattern, reason] of BLOCKED_COMMANDS) {
    if (pattern.test(cmd)) return reason;
  }
  // If command references a managed file in a managed root path, block unless read-only.
  // The filename must appear IN the same path as the managed root (e.g. .pal/.../file.json).
  const segments = cmd.split(/[|;&&]/).map((s) => s.trim());
  for (const name of HOOK_MANAGED_FILES) {
    const pattern = new RegExp(
      `\\.(?:pal|claude|agents|cursor|config/opencode)[/\\\\]\\S*${escapeRegExp(name)}`
    );
    const managed = segments.filter((s) => pattern.test(s));
    if (managed.length > 0 && !managed.every((s) => READ_ONLY_COMMANDS.test(s))) {
      return `${name} is managed automatically by hooks — do not edit directly`;
    }
  }
  for (const dir of HOOK_MANAGED_DIRS) {
    const pattern = new RegExp(
      `\\.(?:pal|claude|agents|cursor|config/opencode)[/\\\\]\\S*${escapeRegExp(dir)}`
    );
    const managed = segments.filter((s) => pattern.test(s));
    if (managed.length > 0 && !managed.every((s) => READ_ONLY_COMMANDS.test(s))) {
      return `${dir} is managed automatically by hooks — do not edit directly`;
    }
  }
  return null;
}

/** Check a file path against protected patterns. Returns a reason string or null. */
export function checkFilePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  // Check hook-managed files — only under managed roots (not repo templates)
  if (isUnderManagedRoot(normalized)) {
    const matchedFile = HOOK_MANAGED_FILES.find((name) =>
      normalized.endsWith(`/${name}`)
    );
    if (matchedFile) {
      return `${matchedFile} is managed automatically by hooks — do not edit directly`;
    }
  }
  // Check hook-managed directories
  const matchedDir = HOOK_MANAGED_DIRS.find((dir) => normalized.includes(`/${dir}/`));
  if (matchedDir) {
    return `${matchedDir}/ is managed automatically by hooks — do not edit directly`;
  }
  // Check system-protected paths
  if (PROTECTED_PATHS.some((pattern) => pattern.test(filePath))) {
    return `Protected path: ${filePath}`;
  }
  return null;
}
