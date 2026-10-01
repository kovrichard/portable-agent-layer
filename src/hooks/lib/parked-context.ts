/**
 * The Copilot CLI drops what its userPromptSubmitted hook returns, but lets the
 * userPromptTransformed hook that follows rewrite the prompt the model receives.
 * The prompt hook parks its context here; the transform hook appends it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type HookTurnPayload, hookSessionId } from "./hook-turn";
import { logError } from "./log";
import { ensureDir, paths } from "./paths";

const MAX_AGE_MS = 2 * 60_000;

interface Parked {
  context: string;
  at: string;
}

export interface TransformedPromptPayload extends HookTurnPayload {
  transformedPrompt?: string;
}

function parkedPath(): string {
  return resolve(ensureDir(paths.state()), "parked-prompt-context.json");
}

function readParked(): Record<string, Parked> {
  const path = parkedPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function isFresh(parked: Parked, now: Date): boolean {
  return now.getTime() - new Date(parked.at).getTime() <= MAX_AGE_MS;
}

function writeFresh(parked: Record<string, Parked>, now: Date): void {
  const fresh = Object.entries(parked).filter(([, p]) => isFresh(p, now));
  writeFileSync(parkedPath(), JSON.stringify(Object.fromEntries(fresh)), "utf-8");
}

export function parkPromptContext(session: string, context: string, now = new Date()) {
  try {
    writeFresh({ ...readParked(), [session]: { context, at: now.toISOString() } }, now);
  } catch (err) {
    logError("parkPromptContext", err);
  }
}

function takePromptContext(session: string, now: Date): string | null {
  const parked = readParked();
  const entry = parked[session];
  if (!entry) return null;
  delete parked[session];
  writeFresh(parked, now);
  return isFresh(entry, now) ? entry.context : null;
}

/** The userPromptTransformed reply that appends the parked context, or null to leave the prompt alone. */
export function transformedPromptResponse(
  payload: TransformedPromptPayload | null,
  now = new Date()
): string | null {
  const session = hookSessionId(payload);
  const facing = payload?.transformedPrompt;
  if (!session || !facing) return null;
  const context = takePromptContext(session, now);
  if (!context) return null;
  return JSON.stringify({ modifiedTransformedPrompt: `${facing}\n\n${context}` });
}
