/**
 * Claude Code's model calls, read off its transcripts into the event log.
 *
 * A message's lines are not all written at once: tool results land between
 * them, and an early line can carry the usage mid-stream. So the newest
 * message of a file still being written is left for the next run, and the
 * cursor stops where it starts.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { appendEvent, eventMonthFile } from "../../../bronze/events";
import { transcriptBytes, transcriptLines } from "../../../bronze/transcript-lines";
import { cacheWritesOf, type TranscriptUsage } from "../../../inference/transcript-usage";
import { type Billing, UNKNOWN } from "../../../usage/billing";
import { claudeTranscripts } from "../usage-buckets";
import { readCursor, writeCursor } from "./cursors";

const SETTLE_MS = 5 * 60_000;

interface ClaudeLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
  effort?: string;
  entrypoint?: string;
  requestedModel?: string;
  thinkingDurationMs?: number;
  message?: {
    id?: string;
    model?: string;
    stop_reason?: string;
    usage?: TranscriptUsage;
  };
}

type ModelCallLine = ClaudeLine & { timestamp: string };

interface SettledRead {
  messages: ModelCallLine[];
  resumeAt: number;
}

function isModelCall(line: ClaudeLine | null): line is ModelCallLine {
  return (
    line?.type === "assistant" &&
    !!line.message?.usage &&
    !!line.message.model &&
    !!line.timestamp &&
    !!line.cwd
  );
}

function parsed(text: string): ClaudeLine | null {
  try {
    return JSON.parse(text) as ClaudeLine;
  } catch {
    return null;
  }
}

/** Only what a model_call needs, so a long transcript's message bodies are not held until the read ends. */
function withoutContent(line: ModelCallLine): ModelCallLine {
  const { id, model, stop_reason, usage } = line.message ?? {};

  return { ...line, message: { id, model, stop_reason, usage } };
}

async function settledMessages(
  transcript: Transcript,
  offset: number
): Promise<SettledRead> {
  const groups = new Map<string, { start: number; line: ModelCallLine }>();
  let newest: string | undefined;
  let end = offset;

  for await (const { text, start, end: lineEnd } of transcriptLines(
    transcript.path,
    offset
  )) {
    end = lineEnd;

    if (!text.includes('"usage"')) continue;
    const line = parsed(text);
    if (!isModelCall(line)) continue;
    const id = line.message?.id ?? `@${start}`;
    groups.set(id, { start: groups.get(id)?.start ?? start, line: withoutContent(line) });
    newest = id;
  }

  const unfinished = transcript.settled || !newest ? undefined : groups.get(newest);
  if (unfinished && newest) groups.delete(newest);

  return {
    messages: [...groups.values()].map((group) => group.line),
    resumeAt: unfinished?.start ?? end,
  };
}

function emitModelCall(line: ClaudeLine, billing: Billing): void {
  const usage = line.message?.usage ?? {};
  appendEvent(
    "model_call",
    {
      ...billing,
      model: line.message?.model,
      requestedModel: line.requestedModel,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      ...cacheWritesOf(usage),
      cacheRead: usage.cache_read_input_tokens,
      thinkingTokens: usage.output_tokens_details?.thinking_tokens,
      thinkingMs: line.thinkingDurationMs,
      webSearches: usage.server_tool_use?.web_search_requests,
      webFetches: usage.server_tool_use?.web_fetch_requests,
      serviceTier: usage.service_tier,
      speed: usage.speed,
      effort: line.effort,
      stopReason: line.message?.stop_reason,
      entrypoint: line.entrypoint,
      sidechain: line.isSidechain,
    },
    {
      ts: line.timestamp,
      session: line.sessionId ?? null,
      runtime: "claude",
      cwd: line.cwd,
    }
  );
}

interface CallKeyParts {
  ts: unknown;
  model: unknown;
  inputTokens: unknown;
  outputTokens: unknown;
  cacheRead: unknown;
}

function callKey(call: CallKeyParts): string {
  return [call.ts, call.model, call.inputTokens, call.outputTokens, call.cacheRead].join(
    "|"
  );
}

function keyOfLine(line: ModelCallLine): string {
  const usage = line.message?.usage ?? {};

  return callKey({
    ts: line.timestamp,
    model: line.message?.model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
  });
}

/**
 * The calls already in the log, keyed without the session: a forked session copies
 * earlier calls under a new session id, and Claude Code copies subagent transcripts
 * into other sessions' folders.
 */
function loggedCalls(): (line: ModelCallLine) => Promise<boolean> {
  const months = new Map<string, Set<string>>();
  const monthKeys = async (ts: string) => {
    const month = ts.slice(0, 7);
    const known = months.get(month) ?? (await callKeysIn(eventMonthFile(new Date(ts))));
    months.set(month, known);

    return known;
  };

  return async (line) => {
    const known = await monthKeys(line.timestamp);
    const key = keyOfLine(line);
    if (known.has(key)) return true;
    known.add(key);

    return false;
  };
}

async function callKeysIn(monthFile: string): Promise<Set<string>> {
  const keys = new Set<string>();

  if (!existsSync(monthFile)) return keys;

  for await (const { text } of transcriptLines(monthFile)) {
    if (!text.includes('"type":"model_call"')) continue;
    const event = parsed(text) as CallKeyParts | null;
    if (event) keys.add(callKey(event));
  }

  return keys;
}

function isSettled(filepath: string, now: Date): boolean {
  return now.getTime() - statSync(filepath).mtimeMs > SETTLE_MS;
}

export interface Transcript {
  key: string;
  path: string;
  settled: boolean;
}

function liveTranscripts(projectsDir: string, now: Date): Transcript[] {
  return claudeTranscripts(projectsDir).map((filepath) => ({
    key: relative(projectsDir, filepath).split(sep).join("/"),
    path: filepath,
    settled: isSettled(filepath, now),
  }));
}

/** Lines past `offset`, or none without opening the file when it has not grown. */
export function hasGrown(transcript: Transcript, offset: number): boolean {
  return transcriptBytes(transcript.path) > offset;
}

function copiesOfDeletedTranscripts(
  copiesDir: string,
  projectsDir: string
): Transcript[] {
  if (!existsSync(copiesDir)) return [];

  return readdirSync(copiesDir, { recursive: true, encoding: "utf-8" })
    .map((file) => file.split(sep).join("/"))
    .filter((file) => file.endsWith(".jsonl.gz"))
    .map((file) => file.slice(0, -".gz".length))
    .filter((key) => !existsSync(resolve(projectsDir, key)))
    .map((key) => ({
      key,
      path: resolve(copiesDir, `${key}.gz`),
      settled: true,
    }));
}

/** Every transcript to read: the live ones, and PAL's copy of each one Claude Code already deleted. */
export function claudeTranscriptSources(
  projectsDir: string,
  now: Date,
  copiesDir?: string
): Transcript[] {
  return [
    ...liveTranscripts(projectsDir, now),
    ...(copiesDir ? copiesOfDeletedTranscripts(copiesDir, projectsDir) : []),
  ];
}

/** Reads each transcript from its cursor; one Claude Code already deleted is read from PAL's copy. */
export async function collectClaude(
  projectsDir: string,
  now: Date = new Date(),
  billingAt: (at: string) => Billing = () => UNKNOWN,
  copiesDir?: string
): Promise<number> {
  const cursor = readCursor("claude");
  const alreadyLogged = loggedCalls();
  let emitted = 0;

  for (const transcript of claudeTranscriptSources(projectsDir, now, copiesDir)) {
    const offset = Number(cursor[transcript.key] ?? 0);
    if (!hasGrown(transcript, offset)) continue;
    const read = await settledMessages(transcript, offset);
    if (read.resumeAt === offset) continue;

    for (const line of read.messages) {
      if (await alreadyLogged(line)) continue;
      emitModelCall(line, billingAt(line.timestamp));
      emitted += 1;
    }

    cursor[transcript.key] = read.resumeAt;
    writeCursor("claude", cursor);
  }

  return emitted;
}
