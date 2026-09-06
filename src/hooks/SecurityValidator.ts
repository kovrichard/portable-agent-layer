/**
 * Hook: PreToolUse — Guards against dangerous commands.
 * Emits the current agent's deny response to block, or exits silently to allow.
 *
 * Fail-open design: if anything goes wrong, the command is allowed through.
 */

import { blockResponse, normalizeToolUse } from "./lib/agent";
import { recordBlocked } from "./lib/ledger";
import { logDebug, logError } from "./lib/log";
import { checkBashCommand, checkFilePath } from "./lib/security";
import { readStdinJSON } from "./lib/stdin";

// beforeShellExecution shape (Cursor only) — flat, no tool-name wrapper
interface ShellExecInput {
  command: string;
  sandbox?: boolean;
}

type SecurityInput = Record<string, unknown> | ShellExecInput;

function isShellExec(input: SecurityInput): input is ShellExecInput {
  return !("tool_name" in input) && !("toolName" in input) && "command" in input;
}

// A name this list misses is a command this hook waves through, so both sets mirror
// the tool names VS Code's own Copilot build ships in its shell and edit tool sets.
const SHELL_TOOLS = [
  "bash",
  "shell",
  "powershell",
  "local_shell",
  "runinterminal",
  "run_in_terminal",
  "terminal",
  "execute_command",
];

const FILE_WRITE_TOOLS = [
  "write",
  "edit",
  "multiedit",
  "write_file",
  "apply_patch",
  "applypatch",
  "create",
  "create_file",
  "createfile",
  "str_replace",
  "str_replace_editor",
  "insert",
  "insert_edit_into_file",
  "replace_string_in_file",
  "multi_replace_string_in_file",
  "replacestring",
  "edit_notebook_file",
  "notebookedit",
];

/** First of `keys` present as a non-empty string — agents disagree on argument spelling. */
function firstStringArg(
  args: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** Tool names that run a shell command, across every agent's naming. */
function runsShellCommand(toolName: string): boolean {
  return SHELL_TOOLS.includes(toolName.toLowerCase());
}

/** Tool names that write to a file, across every agent's naming. */
function writesFile(toolName: string): boolean {
  return FILE_WRITE_TOOLS.includes(toolName.toLowerCase());
}

/**
 * The refusal, written down. Its own try/catch and always called after the deny
 * has gone out: this hook is fail-open, and a ledger that threw on its way to
 * recording a block would turn the block into an allow.
 */
function noteRefusal(tool: string, target: string, reason: string, command?: string) {
  try {
    recordBlocked({ tool, target, reason, ...(command ? { command } : {}) });
  } catch (err) {
    logError("SecurityValidator:ledger", err);
  }
}

try {
  const input = await readStdinJSON<SecurityInput>();
  if (!input) process.exit(0);

  if (isShellExec(input)) {
    // beforeShellExecution — command is always a shell command
    const reason = checkBashCommand(input.command);
    if (reason) {
      process.stdout.write(blockResponse(`Blocked: ${reason}`));
      noteRefusal("shell", process.cwd(), reason, input.command);
    }
    process.exit(0);
  }

  const toolUse = normalizeToolUse(input);
  if (!toolUse) process.exit(0);

  // Each agent names its shell/write tools differently; log the real name so an
  // unrecognized one shows up here instead of silently skipping the check.
  logDebug(
    "SecurityValidator",
    `toolName=${toolUse.toolName} args=${Object.keys(toolUse.toolInput).join(",")}`
  );

  const command = firstStringArg(toolUse.toolInput, ["command", "commandLine", "script"]);
  if (runsShellCommand(toolUse.toolName) && typeof command === "string") {
    const reason = checkBashCommand(command);
    const verdict = reason ? `BLOCK(${reason})` : "ALLOW";
    // "No output" from a downstream tool is indistinguishable between "denied,
    // never ran" and "ran, produced nothing" — logging the verdict here, next
    // to the literal command, is what actually tells the two apart.
    logDebug("SecurityValidator", `bashVerdict=${verdict} command=${command}`);
    if (reason) {
      process.stdout.write(blockResponse(`Blocked: ${reason}`, toolUse.hookEventName));
      noteRefusal(toolUse.toolName, process.cwd(), reason, command);
      process.exit(0);
    }
  }

  const filePath = firstStringArg(toolUse.toolInput, ["file_path", "filePath", "path"]);
  if (writesFile(toolUse.toolName) && typeof filePath === "string") {
    const reason = checkFilePath(filePath);
    if (reason) {
      process.stdout.write(blockResponse(reason, toolUse.hookEventName));
      noteRefusal(toolUse.toolName, filePath, reason);
      process.exit(0);
    }
  }
} catch {
  // Fail open
  process.exit(0);
}
