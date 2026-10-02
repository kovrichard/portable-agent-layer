/**
 * What each agent is handed at session start, and in which envelope.
 *
 * The four runtimes disagree on all of it: whether AGENTS.md is already loaded,
 * which JSON key carries injected context, and whether it is read from stdout at
 * all. This has been wrong in production before — Copilot silently received no
 * context for weeks — and none of it was reachable from a test.
 */

export interface ContextEnvelope {
  /** Whether the agent parses stdout as JSON or reads it as raw text. */
  kind: "json" | "text";
  payload: string;
  /** Copilot only: the same context, also written where its extension reads. */
  file?: string;
}

/**
 * A subagent gets none of this. Its parent already carries the context, and
 * paying for it again on every spawn is the whole cost of a cheap subagent.
 */
export function isSubagentSession(env: NodeJS.ProcessEnv): boolean {
  if (env.CLAUDE_AGENT_TYPE !== undefined) return true;
  return env.CLAUDE_PROJECT_DIR?.includes("/.claude/Agents/") ?? false;
}

/** VS Code runs the hooks in ~/.claude/settings.json too, and reads only hookSpecificOutput. */
const SHARES_CLAUDE_SETTINGS: ReadonlySet<string> = new Set(["claude", "vscode"]);

export type SessionStartContext = "full" | "without-handoff" | "none";

/**
 * Claude Code and Codex replay the context injected at startup when a session
 * is resumed. Copilot does not document it, and has shipped a release that
 * dropped startup context, so it keeps getting the full context on resume.
 */
const RESUME_KEEPS_CONTEXT: ReadonlySet<string> = new Set(["claude", "codex"]);

/**
 * After a compaction, CompactRecover restores the last exchange, so the
 * handoff is redundant. Agents that name no source get everything.
 */
export function contextForSource(
  agent: string,
  source: string | undefined
): SessionStartContext {
  if (source === "resume" && RESUME_KEEPS_CONTEXT.has(agent)) return "none";
  if (source === "compact") return "without-handoff";
  return "full";
}

/**
 * Copilot and Cursor read AGENTS.md natively from nothing, so it is prepended
 * here; Codex reaches it through a symlink and Claude Code loads it itself.
 */
export function needsAgentsMd(agent: string): boolean {
  return agent === "copilot" || agent === "cursor";
}

/**
 * Copilot also writes the same text to a file, because its CLI reads stdout
 * while the VS Code extension reads only ~/.copilot/instructions/.
 */
export function contextEnvelope(
  agent: string,
  reminder: string,
  agentsMd: string
): ContextEnvelope | null {
  const merged = needsAgentsMd(agent)
    ? [agentsMd, reminder].filter(Boolean).join("\n\n")
    : reminder;
  if (!merged) return null;

  if (agent === "copilot") {
    return {
      kind: "json",
      payload: JSON.stringify({ additionalContext: merged }),
      file: merged,
    };
  }
  if (agent === "cursor") {
    return { kind: "json", payload: JSON.stringify({ additional_context: merged }) };
  }
  if (agent === "codex" || SHARES_CLAUDE_SETTINGS.has(agent)) {
    return {
      kind: "json",
      payload: JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: merged },
      }),
    };
  }
  return { kind: "text", payload: merged };
}

/** The file Copilot's VS Code extension reads, with the applyTo header it needs. */
export function copilotInstructions(context: string): string {
  return `---\napplyTo: "**"\n---\n\n${context}`;
}
