/**
 * Agent detection and output format adapters.
 *
 * Each supported agent (Claude Code, Cursor, Codex, Copilot, opencode) uses a
 * different JSON contract for hook I/O and a different mechanism for spawning
 * one-shot subscription-backed inference. These helpers identify which agent
 * is currently running PAL so downstream code can dispatch accordingly.
 *
 * Primary signal: PAL_AGENT env var, set by every install template/plugin in
 * `assets/templates/*` and `src/targets/opencode/plugin.ts`. IDE-provided env
 * vars are used as secondary fallbacks for environments that forward them.
 */

type AgentType = "claude" | "cursor" | "codex" | "copilot" | "opencode";

const KNOWN_AGENTS: ReadonlySet<AgentType> = new Set([
  "claude",
  "cursor",
  "codex",
  "copilot",
  "opencode",
]);

/** Detect which agent is currently running PAL. Defaults to "claude". */
export function getActiveAgent(): AgentType {
  const explicit = process.env.PAL_AGENT;
  if (explicit && KNOWN_AGENTS.has(explicit as AgentType)) {
    return explicit as AgentType;
  }
  if (process.env.CURSOR_VERSION) return "cursor";
  if (process.env.CODEX_CLI_VERSION ?? process.env.OPENAI_CODEX) return "codex";
  return "claude";
}

export const isClaude = () => getActiveAgent() === "claude";
export const isCursor = () => getActiveAgent() === "cursor";
export const isCodex = () => getActiveAgent() === "codex";
export const isCopilot = () => getActiveAgent() === "copilot";
export const isOpencode = () => getActiveAgent() === "opencode";

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
