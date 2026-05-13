/**
 * Hook: PreToolUse — Guards against dangerous commands.
 * Returns JSON { decision: "block", reason: "..." } to block, or exits silently to allow.
 *
 * Fail-open design: if anything goes wrong, the command is allowed through.
 */

import { blockResponse } from "./lib/agent";
import { checkBashCommand, checkFilePath } from "./lib/security";
import { readStdinJSON } from "./lib/stdin";

// preToolUse shape (Claude Code + Cursor)
interface ToolUseInput {
  tool_name: string;
  tool_input: {
    command?: string;
    file_path?: string;
  };
}

// beforeShellExecution shape (Cursor only) — flat, no tool_name wrapper
interface ShellExecInput {
  command: string;
  sandbox?: boolean;
}

type SecurityInput = ToolUseInput | ShellExecInput;

function isShellExec(input: SecurityInput): input is ShellExecInput {
  return !("tool_name" in input) && "command" in input;
}

try {
  const input = await readStdinJSON<SecurityInput>();
  if (!input) process.exit(0);

  if (isShellExec(input)) {
    // beforeShellExecution — command is always a shell command
    const reason = checkBashCommand(input.command);
    if (reason) {
      process.stdout.write(blockResponse(`Blocked: ${reason}`));
    }
    process.exit(0);
  }

  // preToolUse — Claude uses "Bash", Cursor uses "Shell"
  const isBash = input.tool_name === "Bash" || input.tool_name === "Shell";
  const isFileWrite = input.tool_name === "Write" || input.tool_name === "Edit";

  if (isBash && input.tool_input.command) {
    const reason = checkBashCommand(input.tool_input.command);
    if (reason) {
      process.stdout.write(blockResponse(`Blocked: ${reason}`));
      process.exit(0);
    }
  }

  if (isFileWrite && input.tool_input.file_path) {
    const reason = checkFilePath(input.tool_input.file_path);
    if (reason) {
      process.stdout.write(blockResponse(reason));
      process.exit(0);
    }
  }
} catch {
  // Fail open
  process.exit(0);
}
