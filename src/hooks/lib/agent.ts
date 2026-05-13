/**
 * Agent detection and output format adapters.
 *
 * Cursor, Codex, and Claude Code use different JSON contracts for hook I/O.
 * These helpers normalize the differences so hook handlers stay clean.
 */

export type AgentType = "claude" | "cursor" | "codex";

/** Detect which agent is running via environment variables */
export function detectAgent(): AgentType {
  if (process.env.CURSOR_VERSION) return "cursor";
  // Codex CLI sets CODEX_CLI_VERSION; env name may vary — also check OPENAI_CODEX
  if (process.env.CODEX_CLI_VERSION ?? process.env.OPENAI_CODEX) return "codex";
  return "claude";
}

export const isCursor = () => detectAgent() === "cursor";
export const isCodex = () => detectAgent() === "codex";

/**
 * Format a "block this action" response for the current agent.
 * Claude Code:       { decision: "block", reason }
 * Cursor preToolUse: { permission: "deny", user_message }
 * Codex PreToolUse:  { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } }
 */
export function blockResponse(reason: string, hookEventName?: string): string {
  if (isCursor()) {
    return JSON.stringify({ permission: "deny", user_message: reason });
  }
  if (isCodex() && hookEventName === "PreToolUse") {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
  }
  return JSON.stringify({ decision: "block", reason });
}

/**
 * Format sessionStart context injection for the current agent.
 * Claude Code: raw text to stdout
 * Cursor:      { additional_context: "..." }  (snake_case)
 * Codex:       { additionalContext: "..." }   (camelCase)
 */
export function sessionStartOutput(context: string): string {
  if (isCursor()) {
    return JSON.stringify({ additional_context: context });
  }
  if (isCodex()) {
    return JSON.stringify({ additionalContext: context });
  }
  return context;
}
