/**
 * The fields each agent's prompt and stop hooks use for the same things.
 * Claude Code, Codex and VS Code send snake_case, the Copilot CLI camelCase, and
 * Cursor names the session `conversation_id` and hands its final reply to
 * `afterAgentResponse` as `text`. Antigravity names it `conversationId`, and
 * runs its hooks from the plugin folder, naming the workspace in `workspacePaths`.
 */

import { existsSync } from "node:fs";
import { recordReply } from "./interaction";

export interface HookTurnPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  last_assistant_message?: string | null;
  lastAssistantMessage?: string | null;
  text?: string;
}

export function hookSessionId(payload: HookTurnPayload | null | undefined) {
  return (
    payload?.session_id ??
    payload?.sessionId ??
    payload?.conversation_id ??
    payload?.conversationId
  );
}

function declaredWorkspace(payload: object | null | undefined): string | null {
  const paths = payload && "workspacePaths" in payload ? payload.workspacePaths : null;
  const first = Array.isArray(paths) ? paths[0] : undefined;
  return typeof first === "string" && existsSync(first) ? first : null;
}

/**
 * Run the rest of the hook from the workspace the payload names, so everything
 * that reads the project from the working directory sees the user's project.
 */
export function enterHookWorkspace(payload: object | null | undefined): void {
  const workspace = declaredWorkspace(payload);
  if (workspace) process.chdir(workspace);
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
