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
];

/** Hook-managed directories — AI must not write to or delete from these */
export const HOOK_MANAGED_DIRS = [
  "memory/signals",
  "memory/learning/failures",
  "memory/learning/session",
  "memory/learning/synthesis",
  "memory/relationship",
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
  // Derived from HOOK_MANAGED_FILES
  ...HOOK_MANAGED_FILES.map((name) => new RegExp(`[/\\\\]${escapeRegExp(name)}$`)),
];

/** Patterns that warrant a warning (logged but not blocked) */
export const WARN_COMMANDS: RegExp[] = [
  /git\s+push\s+.*--force/,
  /git\s+reset\s+--hard/,
  /drop\s+(?:table|database)/i,
  /truncate\s+table/i,
];

/** Read-only commands allowed to reference protected files */
const READ_ONLY_COMMANDS =
  /^\s*(?:cat|head|tail|less|more|grep|rg|wc|diff|stat|file|ls|dir|git\s+(?:log|diff|blame|show|status)|bat)\b/;

/** Check a bash command against blocked patterns. Returns reason string or null. */
export function checkBashCommand(cmd: string): string | null {
  for (const [pattern, reason] of BLOCKED_COMMANDS) {
    if (pattern.test(cmd)) return reason;
  }
  // If command mentions a protected file, block unless it's read-only
  for (const name of HOOK_MANAGED_FILES) {
    if (cmd.includes(name)) {
      // Check each piped segment — if any segment is not read-only, block
      const segments = cmd.split(/[|;&&]/).map((s) => s.trim());
      const allReadOnly = segments
        .filter((s) => s.includes(name))
        .every((s) => READ_ONLY_COMMANDS.test(s));
      if (!allReadOnly) {
        return `${name} is managed automatically by hooks — do not edit directly`;
      }
    }
  }
  // If command mentions a hook-managed directory, block unless it's read-only
  for (const dir of HOOK_MANAGED_DIRS) {
    if (cmd.includes(dir)) {
      const segments = cmd.split(/[|;&&]/).map((s) => s.trim());
      const allReadOnly = segments
        .filter((s) => s.includes(dir))
        .every((s) => READ_ONLY_COMMANDS.test(s));
      if (!allReadOnly) {
        return `${dir} is managed automatically by hooks — do not edit directly`;
      }
    }
  }
  return null;
}

/** Check a file path against protected patterns. Returns a reason string or null. */
export function checkFilePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  // Check hook-managed files first (more specific message)
  const matchedFile = HOOK_MANAGED_FILES.find((name) => normalized.endsWith(`/${name}`));
  if (matchedFile) {
    return `${matchedFile} is managed automatically by hooks — do not edit directly`;
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
