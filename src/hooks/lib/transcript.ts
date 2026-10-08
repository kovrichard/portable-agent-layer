/**
 * Shared transcript parsing utilities.
 * Used by Stop handlers and the opencode plugin.
 */

import { readFileSync } from "node:fs";
import { antigravityMessage } from "./antigravity-transcript";

interface Message {
  role: string;
  content: string | unknown;
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
    const content = readFileSync(path, "utf-8");
    const messages: Message[] = [];

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = parseTranscriptEntry(JSON.parse(line));
        if (parsed) messages.push(parsed);
      } catch {
        /* skip malformed lines */
      }
    }

    return messages;
  } catch {
    return [];
  }
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
