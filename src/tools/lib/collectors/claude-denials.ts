/**
 * Claude Code's permission denials, read off its transcripts into the event log.
 *
 * For most denials the transcript is the only record: a don't-ask, deny-rule,
 * safety-check or dialog denial fires no hook after PreToolUse, headless or not.
 * Claude Code labels each one on the tool result's line (toolDenialKind, and
 * permissionDecision since 2.1.285).
 */

import { appendEvent } from "../../../bronze/events";
import { transcriptLines } from "../../../bronze/transcript-lines";
import { callTraits } from "../../../usage/call-traits";
import { claudeTranscriptSources, hasGrown, type Transcript } from "./claude";
import { readCursor, writeCursor } from "./cursors";
import { alreadyLoggedCheck } from "./logged-keys";

/**
 * Auto mode's denials fire PermissionDenied, which the post-tool hook already
 * logs; an interrupted call was never refused.
 */
const KINDS_LOGGED_ELSEWHERE = new Set([
  "automode-blocked",
  "automode-unavailable",
  "interrupted",
]);

interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

interface PermissionDecision {
  source?: string;
  reasonCode?: string;
}

interface TranscriptLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  toolDenialKind?: string;
  permissionDecision?: PermissionDecision | null;
  message?: { content?: unknown };
}

interface Call {
  start: number;
  name: string;
  input: Record<string, unknown>;
}

interface Denial {
  start: number;
  toolUseId: string;
  reason: string;
  line: TranscriptLine;
  call: Call;
}

/** Calls still waiting for their result, and the denials found; an answered call is dropped. */
interface WindowRead {
  waiting: Map<string, Call>;
  denials: Denial[];
  end: number;
}

function parsed(text: string): TranscriptLine | null {
  try {
    return JSON.parse(text) as TranscriptLine;
  } catch {
    return null;
  }
}

function blocksOf(line: TranscriptLine): Block[] {
  const content = line.message?.content;

  return Array.isArray(content) ? (content as Block[]) : [];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;

  if (!Array.isArray(content)) return "";

  return content.map((part) => (part as { text?: string }).text ?? "").join(" ");
}

function asInput(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/** A PreToolUse hook's block is a gate's verdict, not a permission denial. */
function blockedByHook(line: TranscriptLine, reason: string): boolean {
  return line.permissionDecision?.source === "hook" || reason.startsWith("PreToolUse:");
}

function denialReason(block: Block, line: TranscriptLine): string | null {
  const kind = line.toolDenialKind;
  if (!kind || KINDS_LOGGED_ELSEWHERE.has(kind) || !block.is_error) return null;
  const reason = textOf(block.content);

  return blockedByHook(line, reason) ? null : reason;
}

function noteResult(read: WindowRead, block: Block, line: TranscriptLine, start: number) {
  const toolUseId = block.tool_use_id;
  if (!toolUseId) return;
  const call = read.waiting.get(toolUseId);
  read.waiting.delete(toolUseId);
  const reason = call && denialReason(block, line);
  if (call && reason) read.denials.push({ start, toolUseId, reason, line, call });
}

function noteBlock(read: WindowRead, block: Block, line: TranscriptLine, start: number) {
  if (line.type === "assistant" && block.type === "tool_use" && block.id && block.name)
    read.waiting.set(block.id, { start, name: block.name, input: asInput(block.input) });

  if (line.type === "user" && block.type === "tool_result")
    noteResult(read, block, line, start);
}

async function readWindow(transcript: Transcript, offset: number): Promise<WindowRead> {
  const read: WindowRead = { waiting: new Map(), denials: [], end: offset };

  for await (const { text, start, end } of transcriptLines(transcript.path, offset)) {
    read.end = end;

    if (!text.includes('"tool_use"') && !text.includes('"tool_result"')) continue;
    const line = parsed(text);
    if (!line) continue;

    for (const block of blocksOf(line)) noteBlock(read, block, line, start);
  }

  return read;
}

function earliest(starts: Iterable<number>, from: number): number {
  let lowest = from;

  for (const start of starts) if (start < lowest) lowest = start;

  return lowest;
}

/**
 * Where the next read starts: before any call still waiting for its result, and
 * before the call of any denial left for that read, so a call and its denial
 * are always read together.
 */
function resumePoint(read: WindowRead): number {
  let resumeAt = earliest(
    [...read.waiting.values()].map((call) => call.start),
    read.end
  );

  for (;;) {
    const deferred = read.denials.filter((d) => d.start >= resumeAt);
    const earlier = earliest(
      deferred.map((d) => d.call.start),
      resumeAt
    );
    if (earlier === resumeAt) return resumeAt;
    resumeAt = earlier;
  }
}

function denialCodeOf(line: TranscriptLine): string | undefined {
  return line.permissionDecision?.reasonCode ?? line.toolDenialKind;
}

function emitDenial({ line, call, toolUseId, reason }: Denial): void {
  appendEvent(
    "tool_call",
    {
      ...callTraits({ toolName: call.name, toolInput: call.input }),
      outcome: "denied",
      denial: denialCodeOf(line),
      toolUseId,
      outputChars: 0,
    },
    {
      ts: line.timestamp,
      session: line.sessionId ?? null,
      runtime: "claude",
      channel: null,
      cwd: line.cwd ?? "",
      content: {
        tool: call.name,
        input: call.input,
        reason,
        kind: line.toolDenialKind,
        decision: line.permissionDecision ?? null,
      },
    }
  );
}

/** Reads each transcript from its own cursor and logs every denial no hook reported. */
export async function collectClaudeDenials(
  projectsDir: string,
  now: Date = new Date(),
  copiesDir?: string
): Promise<number> {
  const cursor = readCursor("claude-denials");
  const alreadyLogged = alreadyLoggedCheck("tool_call", (event) =>
    String(event.toolUseId)
  );
  let emitted = 0;

  for (const transcript of claudeTranscriptSources(projectsDir, now, copiesDir)) {
    const offset = Number(cursor[transcript.key] ?? 0);
    if (!hasGrown(transcript, offset)) continue;
    const read = await readWindow(transcript, offset);
    const resumeAt = resumePoint(read);
    if (resumeAt === offset) continue;

    for (const denial of read.denials.filter((d) => d.start < resumeAt)) {
      const ts = denial.line.timestamp ?? new Date().toISOString();
      const seen = { ts, toolUseId: denial.toolUseId };
      if (await alreadyLogged(seen)) continue;
      emitDenial(denial);
      emitted += 1;
    }

    cursor[transcript.key] = resumeAt;
    writeCursor("claude-denials", cursor);
  }

  return emitted;
}
