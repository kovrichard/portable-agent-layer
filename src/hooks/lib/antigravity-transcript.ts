/**
 * Reading Antigravity's own transcript, `transcript_full.jsonl`: one step per
 * line, `{ step_index, source, type, status, content, ... }`.
 */

import { readFileSync } from "node:fs";
import { type HookTurnPayload, hookFinalReply } from "./hook-turn";

interface AntigravityToolCall {
  name?: string;
  args?: unknown;
}

interface AntigravityStep {
  source?: string;
  type?: string;
  content?: unknown;
  tool_calls?: AntigravityToolCall[];
}

type ModelText = AntigravityStep & { content: string };

export interface AntigravityMessage {
  role: "user" | "assistant";
  content: string;
}

const USER_REQUEST = /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/;

function parsedSteps(raw: string): AntigravityStep[] {
  return raw.split("\n").flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line) as AntigravityStep] : [];
    } catch {
      return [];
    }
  });
}

function stepsOf(transcriptPath: string): AntigravityStep[] {
  try {
    return parsedSteps(readFileSync(transcriptPath, "utf-8"));
  } catch {
    return [];
  }
}

/** Steps PAL injects come back as USER_INPUT too, under source SYSTEM_SDK. */
function typedByUser(step: AntigravityStep): boolean {
  return step.type === "USER_INPUT" && step.source === "USER_EXPLICIT";
}

/** The request inside its envelope, without the metadata agy appends to it. */
function requestText(content: string): string {
  return (USER_REQUEST.exec(content)?.[1] ?? content).trim();
}

/** What the user typed in this step, or null for any step the user did not type. */
export function typedRequest(step: AntigravityStep): string | null {
  return typedByUser(step) && typeof step.content === "string"
    ? requestText(step.content)
    : null;
}

/** What the model said to the user, as opposed to the thinking and tool calls beside it. */
function isModelText(step: AntigravityStep): step is ModelText {
  return (
    step.type === "PLANNER_RESPONSE" &&
    typeof step.content === "string" &&
    step.content.trim() !== ""
  );
}

export function toolCallsOf(step: AntigravityStep): AntigravityToolCall[] {
  return Array.isArray(step.tool_calls) ? step.tool_calls : [];
}

/** A step as a turn of the conversation, or null for everything around the turns. */
export function antigravityMessage(step: AntigravityStep): AntigravityMessage | null {
  const request = typedRequest(step);
  if (request) return { role: "user", content: request };
  return isModelText(step) ? { role: "assistant", content: step.content } : null;
}

/**
 * What the user last typed, or null for a conversation nobody typed into —
 * which is what a subagent's is: it opens on its parent's message instead.
 */
export function latestUserRequest(transcriptPath: string): string | null {
  const step = stepsOf(transcriptPath).findLast(typedByUser);
  return step ? typedRequest(step) : null;
}

function replyToLatestRequest(steps: AntigravityStep[]): string | undefined {
  const request = steps.findLastIndex(typedByUser);
  return steps.slice(request + 1).findLast(isModelText)?.content;
}

export interface AntigravityStopFields {
  conversationId?: string;
  fullyIdle?: boolean;
  transcriptPath?: string | null;
}

/**
 * A stop that ends no turn of the user's: agy still busy, or a subagent's
 * conversation finishing inside its parent's turn. Only an agy payload carries
 * `conversationId`, so no other agent's transcript is ever read here.
 */
export function isSideStop(payload: AntigravityStopFields | null): boolean {
  if (!payload?.conversationId) return false;
  if (payload.fullyIdle === false) return true;
  return (
    typeof payload.transcriptPath === "string" &&
    latestUserRequest(payload.transcriptPath) === null
  );
}

/** agy hands its Stop hook no final reply, but by then the transcript holds it. */
export function withTranscriptReply<T extends AntigravityStopFields & HookTurnPayload>(
  payload: T | null
): T | null {
  if (!payload?.conversationId || typeof payload.transcriptPath !== "string") {
    return payload;
  }
  if (hookFinalReply(payload)) return payload;
  const reply = replyToLatestRequest(stepsOf(payload.transcriptPath));
  return reply ? { ...payload, lastAssistantMessage: reply } : payload;
}
