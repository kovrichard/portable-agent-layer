/**
 * Shared security definitions and validation logic.
 * Used by SecurityValidator.ts (Claude Code) and the opencode plugin.
 */

/** Dangerous command patterns — always blocked */
export const BLOCKED_COMMANDS: [RegExp, string][] = [
  [/rm\s+-rf\s+[\/~]/, "Recursive delete of root or home"],
  [/mkfs\./, "Filesystem format"],
  [/dd\s+if=.*of=\/dev\//, "Raw disk write"],
  [/>\s*\/dev\/sd/, "Direct device write"],
  [/chmod\s+-R\s+777\s+\//, "Recursive world-writable root"],
  [/:\(\)\{\s*:\|:&\s*\};:/, "Fork bomb"],
  [/curl.*\|\s*(?:ba)?sh/, "Pipe to shell"],
  [/wget.*\|\s*(?:ba)?sh/, "Pipe to shell"],
];

/** Paths that should never be written to */
export const PROTECTED_PATHS: RegExp[] = [
  /^\/etc\//,
  /^\/boot\//,
  /^\/System\//,
  /\.ssh\/(?!config)/,
  /\.gnupg\//,
];

/** Patterns that warrant a warning (logged but not blocked) */
export const WARN_COMMANDS: RegExp[] = [
  /git\s+push\s+.*--force/,
  /git\s+reset\s+--hard/,
  /drop\s+(?:table|database)/i,
  /truncate\s+table/i,
];

/** Check a bash command against blocked patterns. Returns reason string or null. */
export function checkBashCommand(cmd: string): string | null {
  for (const [pattern, reason] of BLOCKED_COMMANDS) {
    if (pattern.test(cmd)) return reason;
  }
  return null;
}

/** Check a file path against protected patterns. Returns true if protected. */
export function checkFilePath(filePath: string): boolean {
  return PROTECTED_PATHS.some((pattern) => pattern.test(filePath));
}
