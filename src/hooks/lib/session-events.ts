/**
 * Session boundaries as events: when a session opened and why, when and why it
 * closed, and when its context was compacted.
 */

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { appendEvent, eventsSince, type LoggedEvent, logQuietly } from "./events";
import { type HookTurnPayload, hookSessionId } from "./hook-turn";
import { palPkg } from "./paths";

const SESSION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const MAX_FIELD = 64;

interface SessionStartPayload extends HookTurnPayload {
  source?: string;
  model?: unknown;
}

interface SessionEndPayload extends HookTurnPayload {
  reason?: string;
}

interface CompactionPayload extends HookTurnPayload {
  trigger?: string;
  custom_instructions?: string;
  customInstructions?: string;
  transcript_path?: string;
  transcriptPath?: string;
  context_tokens?: number;
}

function palVersion(): string | null {
  try {
    return JSON.parse(readFileSync(resolve(palPkg(), "package.json"), "utf-8")).version;
  } catch {
    return null;
  }
}

function timezone(now: Date) {
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffsetMin: 0 - now.getTimezoneOffset(),
  };
}

function modelOf(model: unknown): string | null {
  if (typeof model === "string") return model;
  const id = (model as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}

function gitDirOf(start: string): string | null {
  let dir = resolve(start);
  while (true) {
    const dotGit = resolve(dir, ".git");
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return dotGit;
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf-8"))?.[1];
      return pointer ? resolve(dir, pointer.trim()) : null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function gitBranchOf(cwd: string): string | null {
  try {
    const gitDir = gitDirOf(cwd);
    if (!gitDir) return null;
    const head = readFileSync(resolve(gitDir, "HEAD"), "utf-8").trim();
    const branch = /^ref: refs\/heads\/(.+)$/.exec(head)?.[1] ?? "detached";
    return branch.slice(0, MAX_FIELD);
  } catch {
    return null;
  }
}

function runtimeSettings() {
  return {
    effort: process.env.CLAUDE_EFFORT || null,
    entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT || null,
  };
}

export function logSessionStart(
  payload: SessionStartPayload | null,
  now: Date = new Date()
): void {
  logQuietly("session_start", () =>
    appendEvent(
      "session_start",
      {
        source: payload?.source ?? null,
        model: modelOf(payload?.model),
        ...runtimeSettings(),
        branch: gitBranchOf(process.cwd()),
        palVersion: palVersion(),
        ...timezone(now),
      },
      { ts: now.toISOString(), session: hookSessionId(payload) ?? null }
    )
  );
}

function sessionEvents(session: string, now: Date) {
  const since = new Date(now.getTime() - SESSION_LOOKBACK_MS);
  const ofSession = (e: LoggedEvent) => e.session === session;
  return {
    start: eventsSince("session_start", since).find(ofSession),
    turns: eventsSince("turn", since).filter(ofSession).length,
  };
}

function sessionSummary(session: string | null, now: Date) {
  if (!session) return { durationSec: null, turns: null };
  const { start, turns } = sessionEvents(session, now);
  const durationSec = start
    ? Math.round((now.getTime() - Date.parse(start.ts)) / 1000)
    : null;
  return { durationSec, turns };
}

export function logSessionEnd(
  payload: SessionEndPayload | null,
  now: Date = new Date()
): void {
  const session = hookSessionId(payload) ?? null;
  logQuietly("session_end", () =>
    appendEvent(
      "session_end",
      { reason: payload?.reason ?? null, ...sessionSummary(session, now) },
      { ts: now.toISOString(), session }
    )
  );
}

function transcriptTail(path: string): string {
  const size = statSync(path).size;
  const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf-8");
}

interface ContextUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function usageOfLine(line: string): ContextUsage | null {
  try {
    return JSON.parse(line)?.message?.usage ?? null;
  } catch {
    return null;
  }
}

export function contextTokensOf(transcriptPath: string | undefined): number | null {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  const lines = transcriptTail(transcriptPath).split("\n").reverse();
  const usage = lines.map(usageOfLine).find((u) => u !== null);
  if (!usage) return null;
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

function instructionsOf(payload: CompactionPayload | null): string | undefined {
  return payload?.custom_instructions ?? payload?.customInstructions;
}

function compactedTokensOf(payload: CompactionPayload | null): number | null {
  if (typeof payload?.context_tokens === "number") return payload.context_tokens;
  return contextTokensOf(payload?.transcript_path ?? payload?.transcriptPath);
}

export function logCompaction(
  payload: CompactionPayload | null,
  now: Date = new Date()
): void {
  logQuietly("compaction", () =>
    appendEvent(
      "compaction",
      {
        trigger: payload?.trigger ?? null,
        withInstructions: Boolean(instructionsOf(payload)?.trim()),
        contextTokens: compactedTokensOf(payload),
      },
      { ts: now.toISOString(), session: hookSessionId(payload) ?? null }
    )
  );
}
