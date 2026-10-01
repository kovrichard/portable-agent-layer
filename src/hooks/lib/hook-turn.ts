/**
 * The fields each agent's prompt and stop hooks use for the same things.
 * Claude Code, Codex and VS Code send snake_case, the Copilot CLI camelCase, and
 * Cursor names the session `conversation_id` and hands its final reply to
 * `afterAgentResponse` as `text`.
 */

import { recordReply } from "./interaction";

export interface HookTurnPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  last_assistant_message?: string | null;
  lastAssistantMessage?: string | null;
  text?: string;
}

export function hookSessionId(payload: HookTurnPayload | null | undefined) {
  return payload?.session_id ?? payload?.sessionId ?? payload?.conversation_id;
}

export function hookFinalReply(payload: HookTurnPayload | null | undefined) {
  return (
    payload?.last_assistant_message ??
    payload?.lastAssistantMessage ??
    payload?.text ??
    undefined
  );
}

export function fileFinalReply(payload: HookTurnPayload | null | undefined): void {
  const sessionId = hookSessionId(payload);
  const reply = hookFinalReply(payload);
  if (sessionId && reply) recordReply(sessionId, reply);
}
