import { describe, expect, test } from "bun:test";
import {
  type ContextEnvelope,
  contextEnvelope,
  copilotInstructions,
  isSubagentSession,
  needsAgentsMd,
} from "../src/hooks/lib/session-context";

// The four runtimes disagree on every part of this: whether AGENTS.md is already
// loaded, which JSON key carries the context, and whether stdout is read at all.
// It has been wrong in production before — Copilot received no context for weeks
// — and until now the only way to check any of it was to spawn the hook.

const REMINDER = "## Active work\n- one thing";
const AGENTS_MD = "# AGENTS.md\nidentity and routing";

/** Throws rather than returning null, so a missing envelope cannot pass a test. */
function envelopeOf(agent: string): ContextEnvelope {
  const envelope = contextEnvelope(agent, REMINDER, AGENTS_MD);
  if (!envelope) throw new Error(`no envelope for ${agent}`);
  return envelope;
}

function payloadOf(agent: string): Record<string, unknown> {
  return JSON.parse(envelopeOf(agent).payload);
}

describe("which agents need AGENTS.md prepended", () => {
  test.each(["copilot", "cursor"])("%s reads it from nothing, so it is sent", (agent) => {
    expect(needsAgentsMd(agent)).toBe(true);
    expect(envelopeOf(agent).payload).toContain("AGENTS.md");
  });

  test.each([
    "claude",
    "codex",
    "opencode",
  ])("%s already has it, so sending it again would be duplication", (agent) => {
    expect(needsAgentsMd(agent)).toBe(false);
    expect(envelopeOf(agent).payload).not.toContain("identity and routing");
  });
});

describe("the envelope each agent is handed", () => {
  test("Copilot reads additionalContext", () => {
    expect(payloadOf("copilot").additionalContext).toContain(REMINDER);
  });

  test("Cursor reads additional_context — the same word, spelled its own way", () => {
    expect(payloadOf("cursor").additional_context).toContain(REMINDER);
  });

  test("Codex reads it nested under hookSpecificOutput with the event named", () => {
    const nested = payloadOf("codex").hookSpecificOutput as Record<string, unknown>;
    expect(nested.hookEventName).toBe("SessionStart");
    expect(nested.additionalContext).toContain(REMINDER);
  });

  test("Claude Code takes raw text, not JSON", () => {
    const envelope = contextEnvelope("claude", REMINDER, AGENTS_MD);
    expect(envelope?.kind).toBe("text");
    expect(envelope?.payload).toBe(REMINDER);
  });

  test("an agent nobody wrote a branch for is treated as Claude Code, not dropped", () => {
    const envelope = contextEnvelope("opencode", REMINDER, AGENTS_MD);
    expect(envelope?.kind).toBe("text");
    expect(envelope?.payload).toBe(REMINDER);
  });

  test("only Copilot also writes a file — its CLI and its extension read differently", () => {
    expect(envelopeOf("copilot").file).toContain(REMINDER);
    for (const agent of ["cursor", "codex", "claude"]) {
      expect(envelopeOf(agent).file).toBeUndefined();
    }
  });

  test("nothing to say produces no envelope, rather than an empty injection", () => {
    expect(contextEnvelope("claude", "", "")).toBeNull();
    expect(contextEnvelope("copilot", "", "")).toBeNull();
  });

  test("AGENTS.md alone is still worth sending when there is no dynamic context", () => {
    expect(contextEnvelope("copilot", "", AGENTS_MD)?.payload).toContain("AGENTS.md");
  });
});

describe("a subagent session", () => {
  test("is recognised by its agent type, whatever the type is", () => {
    expect(isSubagentSession({ CLAUDE_AGENT_TYPE: "Explore" })).toBe(true);
  });

  test("is recognised by an empty agent type too — set is set", () => {
    expect(isSubagentSession({ CLAUDE_AGENT_TYPE: "" })).toBe(true);
  });

  test("is recognised by the directory it runs in", () => {
    expect(isSubagentSession({ CLAUDE_PROJECT_DIR: "/home/x/.claude/Agents/foo" })).toBe(
      true
    );
  });

  test("an ordinary project directory is not one", () => {
    expect(isSubagentSession({ CLAUDE_PROJECT_DIR: "/home/x/git/repo" })).toBe(false);
  });

  test("a bare session with neither variable is not one", () => {
    expect(isSubagentSession({})).toBe(false);
  });
});

describe("the file Copilot's extension reads", () => {
  test("carries the applyTo header, without which the extension ignores it", () => {
    expect(copilotInstructions("body")).toStartWith('---\napplyTo: "**"\n---');
  });

  test("and the context after it", () => {
    expect(copilotInstructions("body")).toEndWith("body");
  });
});
