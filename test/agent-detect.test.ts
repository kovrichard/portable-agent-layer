import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  blockResponse,
  getActiveAgent,
  isClaude,
  isCodex,
  isCopilot,
  isCursor,
  isOpencode,
  normalizeToolUse,
} from "../src/hooks/lib/agent";

const PRESERVED_ENV_KEYS = [
  "PAL_AGENT",
  "CURSOR_VERSION",
  "CODEX_CLI_VERSION",
  "OPENAI_CODEX",
] as const;

describe("getActiveAgent — PAL_AGENT env signal", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of PRESERVED_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of PRESERVED_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("defaults to claude when nothing is set", () => {
    expect(getActiveAgent()).toBe("claude");
    expect(isClaude()).toBe(true);
  });

  test("detects claude when PAL_AGENT=claude", () => {
    process.env.PAL_AGENT = "claude";
    expect(getActiveAgent()).toBe("claude");
    expect(isClaude()).toBe(true);
  });

  test("detects cursor when PAL_AGENT=cursor", () => {
    process.env.PAL_AGENT = "cursor";
    expect(getActiveAgent()).toBe("cursor");
    expect(isCursor()).toBe(true);
  });

  test("detects codex when PAL_AGENT=codex", () => {
    process.env.PAL_AGENT = "codex";
    expect(getActiveAgent()).toBe("codex");
    expect(isCodex()).toBe(true);
  });

  test("detects copilot when PAL_AGENT=copilot", () => {
    process.env.PAL_AGENT = "copilot";
    expect(getActiveAgent()).toBe("copilot");
    expect(isCopilot()).toBe(true);
  });

  test("detects opencode when PAL_AGENT=opencode", () => {
    process.env.PAL_AGENT = "opencode";
    expect(getActiveAgent()).toBe("opencode");
    expect(isOpencode()).toBe(true);
  });

  test("falls back to CURSOR_VERSION when PAL_AGENT is absent", () => {
    process.env.CURSOR_VERSION = "1.0.0";
    expect(getActiveAgent()).toBe("cursor");
  });

  test("falls back to CODEX_CLI_VERSION when PAL_AGENT is absent", () => {
    process.env.CODEX_CLI_VERSION = "0.130.0";
    expect(getActiveAgent()).toBe("codex");
  });

  test("PAL_AGENT wins over IDE env-var fallbacks", () => {
    process.env.PAL_AGENT = "copilot";
    process.env.CURSOR_VERSION = "1.0.0";
    expect(getActiveAgent()).toBe("copilot");
  });

  test("predicates are mutually exclusive", () => {
    process.env.PAL_AGENT = "copilot";
    expect([isClaude(), isCodex(), isCopilot(), isCursor(), isOpencode()]).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  test("unknown PAL_AGENT value falls back to claude", () => {
    process.env.PAL_AGENT = "bogus";
    expect(getActiveAgent()).toBe("claude");
  });
});

describe("blockResponse", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of PRESERVED_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of PRESERVED_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("codex PreToolUse deny includes a non-empty permissionDecisionReason", () => {
    process.env.PAL_AGENT = "codex";

    const payload = JSON.parse(blockResponse("Blocked: dangerous command", "PreToolUse"));

    expect(payload.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Blocked: dangerous command",
    });
  });

  test("codex non-PreToolUse block keeps the generic block shape", () => {
    process.env.PAL_AGENT = "codex";

    expect(JSON.parse(blockResponse("Blocked elsewhere", "Stop"))).toEqual({
      decision: "block",
      reason: "Blocked elsewhere",
    });
  });

  // Regression: Copilot fell through to Claude's { decision: "block" }, which
  // Copilot does not understand — the deny was silently ignored and the tool ran.
  test("copilot deny uses permissionDecision, not the Claude block shape", () => {
    process.env.PAL_AGENT = "copilot";

    expect(JSON.parse(blockResponse("Blocked: dangerous command"))).toEqual({
      permissionDecision: "deny",
      permissionDecisionReason: "Blocked: dangerous command",
    });
  });

  test("claude keeps the top-level block shape it has always used", () => {
    process.env.PAL_AGENT = "claude";

    const payload = JSON.parse(blockResponse("Blocked: dangerous command"));
    expect(payload.decision).toBe("block");
    expect(payload.reason).toBe("Blocked: dangerous command");
  });

  test("cursor keeps its own deny shape", () => {
    process.env.PAL_AGENT = "cursor";

    expect(JSON.parse(blockResponse("Blocked: dangerous command"))).toEqual({
      permission: "deny",
      user_message: "Blocked: dangerous command",
    });
  });

  // Regression: VS Code's built-in Copilot reads every decision from inside
  // hookSpecificOutput and ignores the top-level keys, so a Claude-shaped deny
  // read to it as no decision at all — the turn ended and the model never
  // learned why. It runs the same ~/.claude/settings.json hooks Claude Code
  // does, so that one payload has to satisfy both or we need two registrations
  // and every hook fires twice.
  test("claude Stop block also nests the VS Code spelling", () => {
    process.env.PAL_AGENT = "claude";

    expect(JSON.parse(blockResponse("Checks failed: knip", "Stop"))).toEqual({
      decision: "block",
      reason: "Checks failed: knip",
      hookSpecificOutput: {
        hookEventName: "Stop",
        decision: "block",
        reason: "Checks failed: knip",
      },
    });
  });

  // A security hook that omits the event name must still deny the tool call,
  // never fall through to a turn-level decision the PreToolUse gate ignores.
  test("claude defaults the nested spelling to a PreToolUse deny", () => {
    process.env.PAL_AGENT = "claude";

    expect(
      JSON.parse(blockResponse("Blocked: dangerous command")).hookSpecificOutput
    ).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Blocked: dangerous command",
    });
  });

  // Regression: routing StopOrchestrator through blockResponse would have handed
  // the Copilot CLI a preToolUse permission shape for a turn-level stop decision.
  test("copilot agentStop keeps the decision shape, not a permission deny", () => {
    process.env.PAL_AGENT = "copilot";

    for (const event of ["Stop", "agentStop"]) {
      expect(JSON.parse(blockResponse("Checks failed: knip", event))).toEqual({
        decision: "block",
        reason: "Checks failed: knip",
      });
    }
  });

  // An explicit --agent=vscode must not lose the nested spelling it relies on.
  test("an explicit vscode override yields the same dual payload", () => {
    for (const event of [undefined, "Stop", "PreToolUse"]) {
      process.env.PAL_AGENT = "claude";
      const asClaude = blockResponse("nope", event);
      process.env.PAL_AGENT = "vscode";
      expect(blockResponse("nope", event)).toBe(asClaude);
    }
  });

  // The reason has to survive into BOTH spellings: VS Code reads only the
  // nested one, so a reason present at the top level alone stops the turn
  // without telling the model anything — the silent-block bug.
  test("every claude/vscode block carries the reason in both spellings", () => {
    for (const agent of ["claude", "vscode"]) {
      process.env.PAL_AGENT = agent;
      for (const event of [undefined, "Stop", "PreToolUse"]) {
        const p = JSON.parse(blockResponse("why it stopped", event));
        expect(p.reason).toBe("why it stopped");
        const nested = p.hookSpecificOutput;
        expect(nested.reason ?? nested.permissionDecisionReason).toBe("why it stopped");
      }
    }
  });
});

describe("getActiveAgent — --agent= argv flag", () => {
  const saved: Record<string, string | undefined> = {};
  const savedArgv = process.argv;

  beforeEach(() => {
    for (const k of PRESERVED_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    process.argv = savedArgv;
    for (const k of PRESERVED_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("reads the agent from --agent= when no env var is set", () => {
    process.argv = ["bun", "hook.ts", "--agent=vscode"];
    expect(getActiveAgent()).toBe("vscode");
  });

  test("argv wins over PAL_AGENT, so one file cannot be mislabelled by a stale env", () => {
    process.argv = ["bun", "hook.ts", "--agent=vscode"];
    process.env.PAL_AGENT = "copilot";
    expect(getActiveAgent()).toBe("vscode");
  });

  test("falls back to PAL_AGENT when the flag is absent", () => {
    process.argv = ["bun", "hook.ts"];
    process.env.PAL_AGENT = "copilot";
    expect(getActiveAgent()).toBe("copilot");
  });

  test("ignores an unknown --agent= value rather than trusting it", () => {
    process.argv = ["bun", "hook.ts", "--agent=bogus"];
    process.env.PAL_AGENT = "copilot";
    expect(getActiveAgent()).toBe("copilot");
  });
});

describe("normalizeToolUse — preToolUse payload shapes", () => {
  // Regression: hooks read only tool_name/tool_input, so Copilot's native
  // camelCase payload matched nothing — a security hook that matches nothing
  // allows everything.
  test("reads Copilot's camelCase toolName/toolArgs", () => {
    expect(
      normalizeToolUse({
        sessionId: "s",
        toolName: "Bash",
        toolArgs: { command: "echo hi" },
      })
    ).toEqual({
      toolName: "Bash",
      toolInput: { command: "echo hi" },
      hookEventName: undefined,
    });
  });

  test("reads the snake_case shape Claude, Cursor and Codex send", () => {
    expect(
      normalizeToolUse({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
      })
    ).toEqual({
      toolName: "Bash",
      toolInput: { command: "echo hi" },
      hookEventName: "PreToolUse",
    });
  });

  test("prefers snake_case when a payload carries both spellings", () => {
    const result = normalizeToolUse({
      tool_name: "Bash",
      toolName: "Ignored",
      tool_input: { command: "wins" },
      toolArgs: { command: "loses" },
    });
    expect(result?.toolName).toBe("Bash");
    expect(result?.toolInput).toEqual({ command: "wins" });
  });

  test("returns an empty toolInput rather than throwing when args are absent", () => {
    expect(normalizeToolUse({ toolName: "Bash" })?.toolInput).toEqual({});
  });

  test("returns null for payloads with no tool name", () => {
    expect(normalizeToolUse({ command: "flat cursor shell payload" })).toBeNull();
    expect(normalizeToolUse({ tool_name: "" })).toBeNull();
  });

  test("returns null for non-object input", () => {
    for (const bad of [null, undefined, "string", 42, []]) {
      expect(normalizeToolUse(bad)).toBeNull();
    }
  });
});
