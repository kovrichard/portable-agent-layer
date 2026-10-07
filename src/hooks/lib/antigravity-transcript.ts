/**
 * Reading Antigravity's own transcript, `transcript_full.jsonl`: one step per
 * line, `{ step_index, source, type, status, content, ... }`.
 */

import { readFileSync } from "node:fs";

interface AntigravityStep {
  source?: string;
  type?: string;
  content?: string;
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

/**
 * What the user last typed, or null for a conversation nobody typed into —
 * which is what a subagent's is: it opens on its parent's message instead.
 */
export function latestUserRequest(transcriptPath: string): string | null {
  const step = stepsOf(transcriptPath).findLast(typedByUser);
  return typeof step?.content === "string" ? requestText(step.content) : null;
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
