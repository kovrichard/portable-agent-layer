/**
 * Hook: PreToolUse — Guards against dangerous commands.
 * Returns JSON { decision: "block", reason: "..." } to block, or exits silently to allow.
 *
 * Fail-open design: if anything goes wrong, the command is allowed through.
 */

import { checkBashCommand, checkFilePath, WARN_COMMANDS } from "./lib/security";
import { readStdinJSON } from "./lib/stdin";

interface ToolUseInput {
  tool_name: string;
  tool_input: {
    command?: string;
    file_path?: string;
  };
}

try {
  const input = await readStdinJSON<ToolUseInput>();
  if (!input) process.exit(0);

  const { tool_name, tool_input } = input;

  // Check Bash commands
  if (tool_name === "Bash" && tool_input.command) {
    const reason = checkBashCommand(tool_input.command);
    if (reason) {
      console.log(JSON.stringify({ decision: "block", reason: `Blocked: ${reason}` }));
      process.exit(0);
    }

    for (const pattern of WARN_COMMANDS) {
      if (pattern.test(tool_input.command)) {
        // Log but don't block — Claude Code's own permission system handles confirmation
        break;
      }
    }
  }

  // Check file path operations (Write, Edit)
  if ((tool_name === "Write" || tool_name === "Edit") && tool_input.file_path) {
    const fileReason = checkFilePath(tool_input.file_path);
    if (fileReason) {
      console.log(JSON.stringify({ decision: "block", reason: fileReason }));
      process.exit(0);
    }
  }
} catch {
  // Fail open
  process.exit(0);
}
