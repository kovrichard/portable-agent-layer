/**
 * Agent detection and output format adapters.
 *
 * Cursor and Claude Code use different JSON contracts for hook I/O.
 * These helpers normalize the differences so hook handlers stay clean.
 */

export type AgentType = "claude" | "cursor";

/** Detect which agent is running via environment variables */
export function detectAgent(): AgentType {
  if (process.env.CURSOR_VERSION) return "cursor";
  return "claude";
}

export const isCursor = () => detectAgent() === "cursor";

/**
 * Format a "block this action" response for the current agent.
 * Claude Code: { decision: "block", reason }
 * Cursor:      { permission: "deny", user_message }
 */
export function blockResponse(reason: string): string {
  if (isCursor()) {
    return JSON.stringify({ permission: "deny", user_message: reason });
  }
  return JSON.stringify({ decision: "block", reason });
}

/**
 * Format sessionStart context injection for the current agent.
 * Claude Code: raw text to stdout
 * Cursor:      { additional_context: "..." }
 */
export function sessionStartOutput(context: string): string {
  if (isCursor()) {
    return JSON.stringify({ additional_context: context });
  }
  return context;
}
