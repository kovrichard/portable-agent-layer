/**
 * Agent detection and output format adapters.
 *
 * Cursor, Codex, and Claude Code use different JSON contracts for hook I/O.
 * These helpers normalize the differences so hook handlers stay clean.
 */

type AgentType = "claude" | "cursor" | "codex";

/** Detect which agent is running via environment variables */
function detectAgent(): AgentType {
  // PAL_AGENT is set explicitly in hook command prefixes — most reliable signal.
  // IDE env vars (CURSOR_VERSION, CODEX_CLI_VERSION) are NOT reliably forwarded to
  // hook subprocesses, so PAL_AGENT is the primary detection mechanism.
  if (process.env.PAL_AGENT === "cursor") return "cursor";
  if (process.env.PAL_AGENT === "codex") return "codex";
  // Fallbacks for environments that do forward IDE env vars
  if (process.env.CURSOR_VERSION) return "cursor";
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
