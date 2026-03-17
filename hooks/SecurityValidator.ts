/**
 * Hook: PreToolUse — Guards against dangerous commands.
 * Returns JSON { decision: "block", reason: "..." } to block, or exits silently to allow.
 *
 * Fail-open design: if anything goes wrong, the command is allowed through.
 */

import { readStdinJSON } from "./lib/stdin";

interface ToolUseInput {
  tool_name: string;
  tool_input: {
    command?: string;
    file_path?: string;
  };
}

// Dangerous command patterns
const BLOCKED_COMMANDS: [RegExp, string][] = [
  [/rm\s+-rf\s+[\/~]/, "Recursive delete of root or home"],
  [/mkfs\./, "Filesystem format"],
  [/dd\s+if=.*of=\/dev\//, "Raw disk write"],
  [/>\s*\/dev\/sd/, "Direct device write"],
  [/chmod\s+-R\s+777\s+\//, "Recursive world-writable root"],
  [/:\(\)\{\s*:\|:&\s*\};:/, "Fork bomb"],
  [/curl.*\|\s*(?:ba)?sh/, "Pipe to shell"],
  [/wget.*\|\s*(?:ba)?sh/, "Pipe to shell"],
];

// Paths that should never be written to
const PROTECTED_PATHS: RegExp[] = [
  /^\/etc\//,
  /^\/boot\//,
  /^\/System\//,
  /\.ssh\/(?!config)/,
  /\.gnupg\//,
];

// Patterns in commands that need confirmation (logged but not blocked)
const WARN_COMMANDS: RegExp[] = [
  /git\s+push\s+.*--force/,
  /git\s+reset\s+--hard/,
  /drop\s+(?:table|database)/i,
  /truncate\s+table/i,
];

try {
  const input = await readStdinJSON<ToolUseInput>();
  if (!input) process.exit(0);

  const { tool_name, tool_input } = input;

  // Check Bash commands
  if (tool_name === "Bash" && tool_input.command) {
    const cmd = tool_input.command;

    for (const [pattern, reason] of BLOCKED_COMMANDS) {
      if (pattern.test(cmd)) {
        console.log(JSON.stringify({ decision: "block", reason: `Blocked: ${reason}` }));
        process.exit(0);
      }
    }

    for (const pattern of WARN_COMMANDS) {
      if (pattern.test(cmd)) {
        // Log but don't block — Claude Code's own permission system handles confirmation
        break;
      }
    }
  }

  // Check file path operations (Write, Edit)
  if ((tool_name === "Write" || tool_name === "Edit") && tool_input.file_path) {
    for (const pattern of PROTECTED_PATHS) {
      if (pattern.test(tool_input.file_path)) {
        console.log(
          JSON.stringify({
            decision: "block",
            reason: `Protected path: ${tool_input.file_path}`,
          })
        );
        process.exit(0);
      }
    }
  }
} catch {
  // Fail open
  process.exit(0);
}
