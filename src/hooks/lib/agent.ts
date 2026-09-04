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

export type AgentType = "claude" | "cursor" | "codex" | "copilot" | "opencode" | "vscode";

const KNOWN_AGENTS: ReadonlySet<AgentType> = new Set([
  "claude",
  "cursor",
  "codex",
  "copilot",
  "opencode",
  "vscode",
]);

function agentFromEnv(): AgentType | undefined {
  const explicit = process.env.PAL_AGENT;
  return explicit && KNOWN_AGENTS.has(explicit as AgentType)
    ? (explicit as AgentType)
    : undefined;
}

/**
 * `--agent=<name>` on the hook's own command line.
 *
 * An `PAL_AGENT=x cmd` prefix is POSIX-only and an `$env:PAL_AGENT='x'; cmd`
 * prefix is PowerShell-only, so a hook config that guesses the host's shell
 * wrong fails before the hook ever runs. An argv flag is shell-agnostic.
 */
function agentFromArgv(): AgentType | undefined {
  const flag = process.argv.find((a) => a.startsWith("--agent="));
  const value = flag?.slice("--agent=".length);
  return value && KNOWN_AGENTS.has(value as AgentType) ? (value as AgentType) : undefined;
}

function agentFromRuntimeEnv(): AgentType | undefined {
  if (process.env.CURSOR_VERSION) return "cursor";
  if (process.env.CODEX_CLI_VERSION ?? process.env.OPENAI_CODEX) return "codex";
  return undefined;
}

/** The agent something actually said was running, or undefined if nothing did. */
export function declaredAgent(): AgentType | undefined {
  return agentFromArgv() ?? agentFromEnv() ?? agentFromRuntimeEnv();
}

/** Which agent's conventions to follow. Assumes "claude" when undeclared. */
export function getActiveAgent(): AgentType {
  return declaredAgent() ?? "claude";
}

export const isClaude = () => getActiveAgent() === "claude";
export const isCursor = () => getActiveAgent() === "cursor";
export const isCodex = () => getActiveAgent() === "codex";
export const isCopilot = () => getActiveAgent() === "copilot";
export const isOpencode = () => getActiveAgent() === "opencode";
const isVscode = () => getActiveAgent() === "vscode";

/** Normalized preToolUse request — one shape for every agent's payload. */
export interface ToolUseRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  hookEventName?: string;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === "string" && v.length > 0);
}

function firstObject(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(
    (v): v is Record<string, unknown> =>
      typeof v === "object" && v !== null && !Array.isArray(v)
  );
}

/** Copilot's CLI sends toolArgs as JSON text where the others send an object. */
function parsedObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return firstObject(parsed);
  } catch {
    return undefined;
  }
}

function toolInputOf(payload: Record<string, unknown>): Record<string, unknown> {
  const candidates = [payload.tool_input, payload.toolArgs, payload.toolInput];
  return firstObject(...candidates) ?? candidates.map(parsedObject).find(Boolean) ?? {};
}

/**
 * Normalize a preToolUse payload across agents.
 *
 * Claude Code, Cursor, Codex — and Copilot's VS Code-compatible mode — send
 * snake_case `tool_name` + `tool_input`. Copilot's native CLI payload sends
 * camelCase `toolName` + `toolArgs`. A hook reading only one shape matches
 * nothing on the other, which for a security hook silently means "allow".
 */
export function normalizeToolUse(raw: unknown): ToolUseRequest | null {
  const payload = firstObject(raw);
  if (!payload) return null;
  const toolName = firstString(payload.tool_name, payload.toolName);
  if (!toolName) return null;
  return {
    toolName,
    toolInput: toolInputOf(payload),
    hookEventName: firstString(payload.hook_event_name, payload.hookEventName),
  };
}

/**
 * Format a "block this action" response for the current agent.
 * Claude Code / VS Code: both spellings at once — see claudeBlock below
 * Cursor preToolUse:     { permission: "deny", user_message }
 * Copilot preToolUse:    { permissionDecision: "deny", permissionDecisionReason }
 * Copilot agentStop:     { decision: "block", reason }
 * Codex PreToolUse:      { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }
 *
 * A stop event denies the whole turn, not one tool call, so it carries a
 * decision rather than a permission — callers must name the event to get it.
 */
function isStopEvent(hookEventName?: string): boolean {
  return hookEventName === "Stop" || hookEventName === "agentStop";
}

/**
 * One payload both Claude Code and VS Code's own Copilot build accept.
 *
 * VS Code reads every decision from inside hookSpecificOutput and ignores the
 * top-level keys; Claude Code reads the top-level keys and ignores the extra
 * object (verified against `claude -p`: a turn carrying both is still blocked).
 * Since VS Code also executes the hooks registered in ~/.claude/settings.json,
 * carrying both spellings here is what lets one registration serve both — a
 * second VS Code-specific hooks file made every event run twice.
 */
function claudeBlock(reason: string, hookEventName?: string): string {
  return JSON.stringify({
    decision: "block",
    reason,
    hookSpecificOutput: isStopEvent(hookEventName)
      ? { hookEventName: "Stop", decision: "block", reason }
      : {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
  });
}

export function blockResponse(reason: string, hookEventName?: string): string {
  if (isCursor()) {
    return JSON.stringify({ permission: "deny", user_message: reason });
  }
  if (isCopilot()) {
    return isStopEvent(hookEventName)
      ? JSON.stringify({ decision: "block", reason })
      : JSON.stringify({
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        });
  }
  if (isCodex() && hookEventName === "PreToolUse") {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    });
  }
  // Only the surfaces that share ~/.claude/settings.json need both spellings.
  // Handing the extra key to codex or opencode would be a shape they never
  // asked to parse, for a duplication problem they don't have.
  if (isClaude() || isVscode()) {
    return claudeBlock(reason, hookEventName);
  }
  return JSON.stringify({ decision: "block", reason });
}
