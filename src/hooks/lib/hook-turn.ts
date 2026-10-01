/**
 * The fields each agent's prompt and stop hooks use for the same things.
 * Claude Code, Codex and VS Code send snake_case, the Copilot CLI camelCase, and
 * Cursor names the session `conversation_id`.
 */

export interface HookTurnPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
}

export function hookSessionId(payload: HookTurnPayload | null | undefined) {
  return payload?.session_id ?? payload?.sessionId ?? payload?.conversation_id;
}
