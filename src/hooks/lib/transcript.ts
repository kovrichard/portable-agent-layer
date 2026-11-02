/**
 * Shared transcript parsing utilities.
 * Used by Stop handlers and the opencode plugin.
 */

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { antigravityMessage } from "./antigravity-transcript";

export interface Message {
  role: string;
  content: string | unknown;
  id?: string;
}

/** Parse raw transcript string into messages array. Returns [] on failure. */
export function parseMessages(raw: string): Message[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function claudeCodeEntryText(msg: { content?: unknown }): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join(" ");
  }
  return "";
}

interface CodexPayload {
  role?: string;
  content?: unknown;
}

const CODEX_INJECTED_CONTEXT = ["# AGENTS.md instructions", "<environment_context>"];

export function isCodexInjectedContext(text: string): boolean {
  return CODEX_INJECTED_CONTEXT.some((prefix) => text.startsWith(prefix));
}

function codexTexts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .map((part) => part?.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0);
}

function codexMessage(payload: CodexPayload | undefined): Message | null {
  const role = payload?.role;
  if (role !== "user" && role !== "assistant") return null;
  const texts = codexTexts(payload?.content).filter(
    (text) => !isCodexInjectedContext(text)
  );
  return texts.length > 0 ? { role, content: texts.join(" ") } : null;
}

// Claude Code tags transcript lines `type: "user"|"assistant"` with the text
// under `message.content`. VS Code Copilot's own event log instead uses
// `type: "user.message"|"assistant.message"` with a flat `data.content`
// string. Codex nests each message as a `response_item` payload. Antigravity
// writes one step per line, `type: "USER_INPUT"|"PLANNER_RESPONSE"|…`.
function parseTranscriptEntry(entry: {
  type?: string;
  message?: { content?: unknown };
  data?: { content?: unknown };
  payload?: CodexPayload;
}): Message | null {
  if (entry.type === "response_item") return codexMessage(entry.payload);
  if (entry.type === "user" || entry.type === "assistant") {
    const text = claudeCodeEntryText(entry.message ?? {});
    return text ? { role: entry.type, content: text } : null;
  }
  if (entry.type === "user.message" || entry.type === "assistant.message") {
    const text = entry.data?.content;
    const role = entry.type === "user.message" ? "user" : "assistant";
    return typeof text === "string" && text ? { role, content: text } : null;
  }
  return antigravityMessage(entry);
}

/**
 * Read an agent transcript JSONL file and extract user/assistant messages.
 * Supports Claude Code's `{type:"user"|"assistant", message:{content}}` shape
 * VS Code Copilot's `{type:"user.message"|"assistant.message", data:{content}}` shape,
 * Codex's `{type:"response_item", payload:{type:"message", role, content}}` shape,
 * and Antigravity's `{type:"USER_INPUT"|"PLANNER_RESPONSE", source, content}` steps.
 */
export function readTranscriptFile(path: string): Message[] {
  try {
    return messagesOf(readFileSync(path, "utf-8").split("\n"));
  } catch {
    return [];
  }
}

interface EntryIds {
  uuid?: string;
  id?: string;
  payload?: { id?: string };
  step_index?: number;
}

/** Claude Code, Copilot, Codex and Antigravity each name a line's id differently. */
function entryId(entry: EntryIds): string | undefined {
  const id = entry.uuid ?? entry.id ?? entry.payload?.id ?? entry.step_index;
  return id === undefined ? undefined : String(id);
}

function messageOfLine(line: string): Message | null {
  try {
    const entry = JSON.parse(line);
    const message = parseTranscriptEntry(entry);
    const id = message && entryId(entry);
    return message && id ? { ...message, id } : message;
  } catch {
    return null;
  }
}

function messagesOf(lines: string[]): Message[] {
  return lines.flatMap((line) => {
    const message = line.trim() ? messageOfLine(line) : null;
    return message ? [message] : [];
  });
}

const TAIL_FIRST_READ_BYTES = 256 * 1024;
const TAIL_MAX_BYTES = 16 * 1024 * 1024;

/**
 * The newest messages of a transcript, read from its end: the read grows until it
 * holds `minUserMessages` user messages, reaches the start of the file, or hits
 * `maxBytes`, so a Stop hook costs the same on a 1 GB transcript as on a 1 MB one.
 */
export function recentMessages(
  path: string,
  minUserMessages: number,
  maxBytes = TAIL_MAX_BYTES
): Message[] {
  try {
    for (let bytes = Math.min(TAIL_FIRST_READ_BYTES, maxBytes); ; bytes *= 4) {
      const read = Math.min(bytes, maxBytes);
      const { lines, whole } = readTranscriptTail(path, read);
      const messages = messagesOf(lines);
      const users = messages.filter((m) => m.role === "user").length;
      if (whole || users >= minUserMessages || read >= maxBytes) return messages;
    }
  } catch {
    return [];
  }
}

/** The messages after the one with `id`; all of them when `id` is not among them. */
export function messagesAfter(messages: Message[], id: string | undefined): Message[] {
  const index = id ? messages.findIndex((m) => m.id === id) : -1;
  return messages.slice(index + 1);
}

/**
 * A Stop hook sees only the transcript's tail, so a session's length is a running
 * total: the count last recorded plus the messages after the id recorded with it.
 * An id missing from the tail adds the whole tail, which errs toward counting more.
 * A transcript without ids has no running total, so its own length stands.
 */
export function runningCount(
  messages: Message[],
  recorded: number | undefined,
  lastId: string | undefined
): number {
  if (recorded === undefined || !messages.some((m) => m.id)) return messages.length;
  return recorded + messagesAfter(messages, lastId).length;
}

/** The complete lines in the last `bytes` of a transcript; `whole` once that reaches its start. */
export function readTranscriptTail(
  path: string,
  bytes: number
): { lines: string[]; whole: boolean } {
  const size = statSync(path).size;
  const length = Math.min(size, bytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  const whole = length === size;
  const lines = buffer.toString("utf-8").split("\n");
  return { lines: (whole ? lines : lines.slice(1)).filter(Boolean), whole };
}

/** Extract string content from a message object */
export function extractContent(msg: Message | undefined): string {
  if (!msg) return "";
  return typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
}

/** Get the last assistant message from a messages array */
export function extractLastAssistant(messages: Message[]): Message | undefined {
  return messages.filter((m) => m.role === "assistant").pop();
}

/** The agent hands its final reply to the Stop hook before that reply reaches the transcript file. */
export function withFinalReply(messages: Message[], finalReply?: string): Message[] {
  const reply = finalReply?.trim();
  if (!reply) return messages;
  const last = messages.at(-1);
  if (last?.role === "assistant" && extractContent(last).includes(reply)) return messages;
  return [...messages, { role: "assistant", content: reply }];
}

/** Get the last user message from a messages array */
export function extractLastUser(messages: Message[]): Message | undefined {
  return messages.filter((m) => m.role === "user").pop();
}
