/**
 * Hook: PreToolUse — Guards against dangerous commands.
 * Returns JSON { decision: "block", reason: "..." } to block, or exits silently to allow.
 *
 * Fail-open design: if anything goes wrong, the command is allowed through.
 */

import { blockResponse } from "./lib/agent";
import { checkBashCommand, checkFilePath } from "./lib/security";
import { readStdinJSON } from "./lib/stdin";

// preToolUse shape (Claude Code + Cursor + Codex)
interface ToolUseInput {
  tool_name: string;
  hook_event_name?: string; // Codex includes this in all hook inputs
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

  const hookEventName = input.hook_event_name;

  // preToolUse — Claude: "Bash", Cursor: "Shell", Codex: "shell"
  const isBash =
    input.tool_name === "Bash" ||
    input.tool_name === "Shell" ||
    input.tool_name === "shell";
  const isFileWrite =
    input.tool_name === "Write" ||
    input.tool_name === "Edit" ||
    input.tool_name === "write_file" ||
    input.tool_name === "apply_patch";

  if (isBash && input.tool_input.command) {
    const reason = checkBashCommand(input.tool_input.command);
    if (reason) {
      process.stdout.write(blockResponse(`Blocked: ${reason}`, hookEventName));
      process.exit(0);
    }
  }

  if (isFileWrite && input.tool_input.file_path) {
    const reason = checkFilePath(input.tool_input.file_path);
    if (reason) {
      process.stdout.write(blockResponse(reason, hookEventName));
      process.exit(0);
    }
  }
} catch {
  // Fail open
  process.exit(0);
}
