import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { decideRefusal } from "../src/hooks/lib/security-gate";

// The gate used to live inside a spawned entrypoint, so none of this was
// reachable: which tool names count as a shell, which argument spells the path,
// and what the agent is told could each be deleted with the suite still green.

const CWD = "/work/app";

// Assembled at runtime so this file does not contain the literal pattern that
// PAL's own SecurityValidator blocks when an agent edits or greps it.
const DANGEROUS = `${"rm -r"}${"f /"}`;

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-gate-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

function wrapped(toolName: string, toolArgs: Record<string, unknown>) {
  return { hook_event_name: "PreToolUse", toolName, toolArgs };
}

describe("a refused shell command", () => {
  test("names itself, because it has no file to name", () => {
    const refusal = decideRefusal(wrapped("Bash", { command: DANGEROUS }), CWD);
    expect(refusal?.command).toBe(DANGEROUS);
    expect(refusal?.target).toBe(CWD);
    expect(refusal?.tool).toBe("Bash");
  });

  test("is framed for the agent but stored plainly", () => {
    const refusal = decideRefusal(wrapped("Bash", { command: DANGEROUS }), CWD);
    expect(refusal?.message).toBe(`Blocked: ${refusal?.reason}`);
    expect(refusal?.reason).not.toStartWith("Blocked:");
  });

  test("the flat Cursor shape is read too, and carries no hook event", () => {
    const refusal = decideRefusal({ command: DANGEROUS }, CWD);
    expect(refusal?.tool).toBe("shell");
    expect(refusal?.command).toBe(DANGEROUS);
    expect(refusal?.hookEventName).toBeUndefined();
  });

  test("the wrapped shape carries the event back, so the deny takes the right shape", () => {
    const refusal = decideRefusal(wrapped("Bash", { command: DANGEROUS }), CWD);
    expect(refusal?.hookEventName).toBe("PreToolUse");
  });

  test("a harmless command is let through", () => {
    expect(decideRefusal(wrapped("Bash", { command: "ls -la" }), CWD)).toBeNull();
  });

  test("a harmless command in the flat shape is let through too", () => {
    expect(decideRefusal({ command: "ls -la" }, CWD)).toBeNull();
  });

  test("the flat shape frames its message the same way", () => {
    const refusal = decideRefusal({ command: DANGEROUS }, CWD);
    expect(refusal?.message).toBe(`Blocked: ${refusal?.reason}`);
  });

  test("an empty command is no command, not a command that says nothing", () => {
    expect(decideRefusal(wrapped("Bash", { command: "" }), CWD)).toBeNull();
  });
});

// Every name in both tables, deliberately: a name the gate misses is a command
// it waves through, so each one is a claim that has to be checked, not a sample.
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

describe("which tool names the gate recognises", () => {
  test.each(SHELL_TOOLS)("%s runs a shell, whatever the agent calls it", (name) => {
    expect(decideRefusal(wrapped(name, { command: DANGEROUS }), CWD)).not.toBeNull();
  });

  test("matching ignores case, since agents disagree on that too", () => {
    expect(decideRefusal(wrapped("BASH", { command: DANGEROUS }), CWD)).not.toBeNull();
  });

  test("a tool the gate does not know is not checked", () => {
    expect(decideRefusal(wrapped("WebFetch", { command: DANGEROUS }), CWD)).toBeNull();
  });

  test.each([
    "command",
    "commandLine",
    "script",
  ])("the command is found however it is spelled: %s", (key) => {
    expect(decideRefusal(wrapped("Bash", { [key]: DANGEROUS }), CWD)).not.toBeNull();
  });

  test("a shell tool carrying no command is not checked", () => {
    expect(decideRefusal(wrapped("Bash", { description: "list" }), CWD)).toBeNull();
  });
});

describe("a refused file write", () => {
  const PROTECTED = "/home/someone/.pal/memory/projects/demo/ISA.md";

  test("names the file, not the directory", () => {
    const refusal = decideRefusal(wrapped("Edit", { file_path: PROTECTED }), CWD);
    expect(refusal?.target).toBe(PROTECTED);
    expect(refusal?.target).not.toBe(CWD);
  });

  test("carries no command, since no shell was involved", () => {
    const refusal = decideRefusal(wrapped("Edit", { file_path: PROTECTED }), CWD);
    expect(refusal?.command).toBeUndefined();
  });

  test("is told to the agent in the words the ledger records", () => {
    const refusal = decideRefusal(wrapped("Edit", { file_path: PROTECTED }), CWD);
    expect(refusal?.message).toBe(refusal?.reason);
  });

  test.each([
    "file_path",
    "filePath",
    "path",
  ])("the path is found however it is spelled: %s", (key) => {
    expect(decideRefusal(wrapped("Write", { [key]: PROTECTED }), CWD)).not.toBeNull();
  });

  test.each(FILE_WRITE_TOOLS)("%s writes a file, whatever the agent calls it", (name) => {
    expect(decideRefusal(wrapped(name, { file_path: PROTECTED }), CWD)).not.toBeNull();
  });

  test("an ordinary file is let through", () => {
    expect(
      decideRefusal(wrapped("Edit", { file_path: "/work/app/a.ts" }), CWD)
    ).toBeNull();
  });

  test("an empty path is no path, so nothing is checked", () => {
    expect(decideRefusal(wrapped("Edit", { file_path: "" }), CWD)).toBeNull();
  });

  test("a read of the same file is not a write, so it is not checked", () => {
    expect(decideRefusal(wrapped("Read", { file_path: PROTECTED }), CWD)).toBeNull();
  });
});

// Cursor's flat shape and a wrapped one are told apart by the absence of a tool
// name, so a payload carrying both is the case the discriminator exists for.
describe("a payload that could be read either way", () => {
  test("a tool name means it is wrapped, even with a command alongside it", () => {
    const refusal = decideRefusal({ toolName: "Bash", command: DANGEROUS }, CWD);
    // Read flat, this would be tool "shell" with the top-level command. Read as
    // wrapped, the command sits outside toolArgs and nothing is checked at all.
    expect(refusal).toBeNull();
  });

  test("the snake_case spelling of the tool name counts too", () => {
    expect(decideRefusal({ tool_name: "Bash", command: DANGEROUS }, CWD)).toBeNull();
  });

  test("no tool name at all means it is Cursor's flat shape", () => {
    expect(decideRefusal({ command: DANGEROUS, sandbox: false }, CWD)?.tool).toBe(
      "shell"
    );
  });
});

describe("input the gate cannot read", () => {
  test("a payload with no tool name and no command decides nothing", () => {
    expect(decideRefusal({ hook_event_name: "PreToolUse" }, CWD)).toBeNull();
  });

  test("an empty object decides nothing", () => {
    expect(decideRefusal({}, CWD)).toBeNull();
  });
});
