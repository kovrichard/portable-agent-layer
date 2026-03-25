/**
 * Hook: PreToolUse — Guards against dangerous commands.
 * Returns JSON { decision: "block", reason: "..." } to block, or exits silently to allow.
 *
 * Fail-open design: if anything goes wrong, the command is allowed through.
 */

import { blockResponse } from "./lib/agent";
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

  // Normalize tool names: Claude uses "Bash", Cursor uses "Shell"
  const isBash = tool_name === "Bash" || tool_name === "Shell";
  const isFileWrite = tool_name === "Write" || tool_name === "Edit";

  // Check shell commands
  if (isBash && tool_input.command) {
    const reason = checkBashCommand(tool_input.command);
    if (reason) {
      process.stdout.write(blockResponse(`Blocked: ${reason}`));
      process.exit(0);
    }

    for (const pattern of WARN_COMMANDS) {
      if (pattern.test(tool_input.command)) {
        break;
      }
    }
  }

  // Check file path operations
  if (isFileWrite && tool_input.file_path) {
    const fileReason = checkFilePath(tool_input.file_path);
    if (fileReason) {
      process.stdout.write(blockResponse(fileReason));
      process.exit(0);
    }
  }
} catch {
  // Fail open
  process.exit(0);
}
