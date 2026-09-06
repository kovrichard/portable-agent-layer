/**
 * The gate's decision, separated from the process that carries it out.
 *
 * SecurityValidator is spawned, so nothing can import it and nothing measures
 * it — every rule about which tool names run a shell, which argument spells the
 * path, and what the agent is told was unreachable from a test. The decision
 * lives here instead; the entrypoint is left with stdin, stdout and the ledger.
 */

import { normalizeToolUse } from "./agent";
import { logDebug } from "./log";
import { checkBashCommand, checkFilePath } from "./security";

/** beforeShellExecution (Cursor only) — flat, no tool-name wrapper. */
interface ShellExecInput {
  command: string;
  sandbox?: boolean;
}

export type SecurityInput = Record<string, unknown> | ShellExecInput;

export interface GateRefusal {
  tool: string;
  /** The file, or the directory a refused command would have run in. */
  target: string;
  /** Set only when a shell was refused: it has no file to name. */
  command?: string;
  /** Why, for the ledger. */
  reason: string;
  /** Why, in the words the agent is given — the two differ only by framing. */
  message: string;
  hookEventName?: string;
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

function isShellExec(input: SecurityInput): input is ShellExecInput {
  return !("tool_name" in input) && !("toolName" in input) && "command" in input;
}

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
 * What the gate would do with this call, or null to let it through.
 *
 * `cwd` is passed rather than read so a test can pin the target of a refused
 * command, which has no file of its own to name.
 */
export function decideRefusal(input: SecurityInput, cwd: string): GateRefusal | null {
  if (isShellExec(input)) {
    const reason = checkBashCommand(input.command);
    if (!reason) return null;
    return {
      tool: "shell",
      target: cwd,
      command: input.command,
      reason,
      message: `Blocked: ${reason}`,
    };
  }

  const toolUse = normalizeToolUse(input);
  if (!toolUse) return null;

  // Each agent names its shell/write tools differently; log the real name so an
  // unrecognized one shows up here instead of silently skipping the check.
  logDebug(
    "SecurityValidator",
    `toolName=${toolUse.toolName} args=${Object.keys(toolUse.toolInput).join(",")}`
  );

  const command = firstStringArg(toolUse.toolInput, ["command", "commandLine", "script"]);
  if (runsShellCommand(toolUse.toolName) && command) {
    const reason = checkBashCommand(command);
    // "No output" from a downstream tool is indistinguishable between "denied,
    // never ran" and "ran, produced nothing" — logging the verdict here, next
    // to the literal command, is what actually tells the two apart.
    const verdict = reason ? `BLOCK(${reason})` : "ALLOW";
    logDebug("SecurityValidator", `bashVerdict=${verdict} command=${command}`);
    if (reason) {
      return {
        tool: toolUse.toolName,
        target: cwd,
        command,
        reason,
        message: `Blocked: ${reason}`,
        hookEventName: toolUse.hookEventName,
      };
    }
  }

  const filePath = firstStringArg(toolUse.toolInput, ["file_path", "filePath", "path"]);
  if (writesFile(toolUse.toolName) && filePath) {
    const reason = checkFilePath(filePath);
    if (reason) {
      return {
        tool: toolUse.toolName,
        target: filePath,
        reason,
        message: reason,
        hookEventName: toolUse.hookEventName,
      };
    }
  }

  return null;
}
