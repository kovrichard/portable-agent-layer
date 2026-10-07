/**
 * Antigravity's PreInvocation, which stands in for both SessionStart and
 * UserPromptSubmit: agy has neither, and fires this before every model call.
 *
 * Only the first call of a turn (`invocationNum` 0) carries a new prompt. Its
 * one reply injects a `userMessage` step, which agy keeps for the rest of the
 * conversation — so the session context goes in once per conversation and the
 * prompt context once per turn.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPromptContext } from "../handlers/inject-retrieval";
import { latestUserRequest } from "./antigravity-transcript";
import { autoUpdateOnStart } from "./auto-update";
import { regenerateIfNeeded } from "./claude-md";
import { buildSystemReminder } from "./context";
import { type HookTurnPayload, hookSessionId } from "./hook-turn";
import { logContextSnapshot, logError, logPromptSnapshot } from "./log";
import { paths } from "./paths";
import { capturePrompt } from "./prompt-capture";

export interface InvocationPayload extends HookTurnPayload {
  invocationNum?: number;
  transcriptPath?: string;
}

const REMEMBERED_CONVERSATIONS = 200;

function startedFile(): string {
  return resolve(paths.state(), "antigravity-conversations.json");
}

function startedConversations(): string[] {
  try {
    const file = startedFile();
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : [];
  } catch {
    return [];
  }
}

/** True exactly once per conversation: the call that gets to start it. */
function claimConversationStart(conversationId: string): boolean {
  const started = startedConversations();
  if (started.includes(conversationId)) return false;
  const kept = [...started, conversationId].slice(-REMEMBERED_CONVERSATIONS);
  writeFileSync(startedFile(), JSON.stringify(kept), "utf-8");
  return true;
}

function attempt(label: string, work: () => unknown): void {
  try {
    work();
  } catch (err) {
    logError(`InvocationContext:${label}`, err);
  }
}

function sessionStartReminder(): string {
  attempt("regenerate", regenerateIfNeeded);
  attempt("auto-update", autoUpdateOnStart);
  const reminder = buildSystemReminder({ agent: "claude" });
  if (reminder) logContextSnapshot(reminder);
  return reminder;
}

async function promptReminder(prompt: string, conversationId: string) {
  const context = await getPromptContext(prompt, conversationId);
  logPromptSnapshot(prompt, context);
  return context;
}

/** The agy reply that adds `text` to the conversation as one user step. */
function injectedStep(text: string): string {
  return JSON.stringify({ injectSteps: [{ userMessage: text }] });
}

/** What PreInvocation should print, or null to print nothing. */
export async function invocationContext(
  payload: InvocationPayload,
  sentAt: Date = new Date()
): Promise<string | null> {
  const conversationId = hookSessionId(payload);
  if (payload.invocationNum !== 0 || !conversationId || !payload.transcriptPath) {
    return null;
  }

  const prompt = latestUserRequest(payload.transcriptPath);
  if (prompt === null) return null;

  const parts = [
    claimConversationStart(conversationId) ? sessionStartReminder() : null,
    await promptReminder(prompt, conversationId),
  ].filter((part): part is string => Boolean(part));
  await capturePrompt(prompt, conversationId, sentAt, "InvocationContext");

  return parts.length > 0 ? injectedStep(parts.join("\n\n")) : null;
}
