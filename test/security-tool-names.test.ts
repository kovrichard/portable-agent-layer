import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const HOOK = resolve(import.meta.dir, "../src/hooks/SecurityValidator.ts");

// Assembled at runtime so this file does not contain the literal pattern that
// PAL's own SecurityValidator blocks when an agent edits or greps it.
const DANGEROUS = `${"rm -r"}${"f /"}`;

async function runValidator(payload: unknown, agent = "vscode"): Promise<string> {
  const proc = Bun.spawn(["bun", "run", HOOK, `--agent=${agent}`], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

function preToolUse(toolName: string, toolArgs: Record<string, unknown>) {
  return { hook_event_name: "PreToolUse", toolName, toolArgs };
}

// Regression: the matcher listed only "bash" and "shell". VS Code's Copilot build
// ships a shell tool set of bash/powershell/local_shell/runInTerminal/run_in_terminal,
// so its real shell tool matched nothing — and a security hook that matches nothing
// allows everything.
describe("SecurityValidator — shell tool names", () => {
  const SHELL_TOOL_NAMES = [
    "bash",
    "Bash",
    "shell",
    "powershell",
    "local_shell",
    "runInTerminal",
    "run_in_terminal",
  ];

  for (const toolName of SHELL_TOOL_NAMES) {
    test(`denies a recursive root delete via "${toolName}"`, async () => {
      const out = await runValidator(preToolUse(toolName, { command: DANGEROUS }));
      expect(out).toContain("permissionDecision");
      expect(out).toContain("deny");
    });
  }

  test("allows a harmless command through the same tool", async () => {
    const out = await runValidator(
      preToolUse("runInTerminal", { command: "npm run build" })
    );
    expect(out).toBe("");
  });

  test("does not treat a read-only tool as a shell", async () => {
    const out = await runValidator(preToolUse("readFile", { command: DANGEROUS }));
    expect(out).toBe("");
  });
});

describe("SecurityValidator — argument spelling", () => {
  test("reads the command from commandLine as well as command", async () => {
    const out = await runValidator(
      preToolUse("runInTerminal", { commandLine: DANGEROUS })
    );
    expect(out).toContain("deny");
  });
});

describe("SecurityValidator — per-agent deny shape", () => {
  test("vscode nests the deny inside hookSpecificOutput", async () => {
    const out = await runValidator(preToolUse("runInTerminal", { command: DANGEROUS }));
    const payload = JSON.parse(out);
    expect(payload.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(payload.permissionDecision).toBeUndefined();
  });

  test("copilot CLI keeps the flat top-level deny", async () => {
    const out = await runValidator(
      preToolUse("runInTerminal", { command: DANGEROUS }),
      "copilot"
    );
    const payload = JSON.parse(out);
    expect(payload.permissionDecision).toBe("deny");
    expect(payload.hookSpecificOutput).toBeUndefined();
  });
});
