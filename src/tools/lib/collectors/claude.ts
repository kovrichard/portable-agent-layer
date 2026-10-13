/**
 * Claude Code's model calls, read off its transcripts into the event log.
 *
 * A message's lines are not all written at once: tool results land between
 * them, and an early line can carry the usage mid-stream. So the newest
 * message of a file still being written is left for the next run, and the
 * cursor stops where it starts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { appendEvent } from "../../../hooks/lib/events";
import { cacheWritesOf, type TranscriptUsage } from "../transcript-usage";
import { claudeTranscripts } from "../usage-buckets";
import { type Billing, UNKNOWN } from "./billing";
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

function completeLinesFrom(bytes: Buffer, offset: number) {
  const end = bytes.lastIndexOf(10) + 1;
  if (end <= offset) return { lines: [], end: offset };
  const lines: { text: string; start: number }[] = [];
  let start = offset;
  for (const text of bytes
    .subarray(offset, end - 1)
    .toString("utf-8")
    .split("\n")) {
    lines.push({ text, start });
    start += Buffer.byteLength(text) + 1;
  }
  return { lines, end };
}

function settledMessages(bytes: Buffer, offset: number, settled: boolean): SettledRead {
  const { lines, end } = completeLinesFrom(bytes, offset);
  const groups = new Map<string, { start: number; line: ModelCallLine }>();
  let newest: string | undefined;
  for (const { text, start } of lines) {
    if (!text.includes('"usage"')) continue;
    const line = parsed(text);
    if (!isModelCall(line)) continue;
    const id = line.message?.id ?? `@${start}`;
    groups.set(id, { start: groups.get(id)?.start ?? start, line });
    newest = id;
  }
  const unfinished = settled || !newest ? undefined : groups.get(newest);
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

function isSettled(filepath: string, now: Date): boolean {
  return now.getTime() - statSync(filepath).mtimeMs > SETTLE_MS;
}

interface Transcript {
  key: string;
  bytes: () => Buffer;
  settled: boolean;
}

function liveTranscripts(projectsDir: string, now: Date): Transcript[] {
  return claudeTranscripts(projectsDir).map((filepath) => ({
    key: relative(projectsDir, filepath).split(sep).join("/"),
    bytes: () => readFileSync(filepath),
    settled: isSettled(filepath, now),
  }));
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
      bytes: () =>
        Buffer.from(Bun.gunzipSync(readFileSync(resolve(copiesDir, `${key}.gz`)))),
      settled: true,
    }));
}

/** Reads each transcript from its cursor; one Claude Code already deleted is read from PAL's copy. */
export function collectClaude(
  projectsDir: string,
  now: Date = new Date(),
  billingAt: (at: string) => Billing = () => UNKNOWN,
  copiesDir?: string
): number {
  const cursor = readCursor("claude");
  let emitted = 0;
  const transcripts = [
    ...liveTranscripts(projectsDir, now),
    ...(copiesDir ? copiesOfDeletedTranscripts(copiesDir, projectsDir) : []),
  ];
  for (const transcript of transcripts) {
    const offset = Number(cursor[transcript.key] ?? 0);
    const read = settledMessages(transcript.bytes(), offset, transcript.settled);
    if (read.resumeAt === offset) continue;
    for (const line of read.messages) emitModelCall(line, billingAt(line.timestamp));
    emitted += read.messages.length;
    cursor[transcript.key] = read.resumeAt;
    writeCursor("claude", cursor);
  }
  return emitted;
}
