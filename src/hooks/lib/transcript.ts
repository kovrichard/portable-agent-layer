/**
 * Shared transcript parsing utilities.
 * Used by Stop handlers and the opencode plugin.
 */

import { readFileSync } from "node:fs";

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

// Claude Code tags transcript lines `type: "user"|"assistant"` with the text
// under `message.content`. VS Code Copilot's own event log instead uses
// `type: "user.message"|"assistant.message"` with a flat `data.content`
// string — two shapes sharing one transcript_path contract across agents.
function parseTranscriptEntry(entry: {
  type?: string;
  message?: { content?: unknown };
  data?: { content?: unknown };
}): Message | null {
  if (entry.type === "user" || entry.type === "assistant") {
    const text = claudeCodeEntryText(entry.message ?? {});
    return text ? { role: entry.type, content: text } : null;
  }
  if (entry.type === "user.message" || entry.type === "assistant.message") {
    const text = entry.data?.content;
    const role = entry.type === "user.message" ? "user" : "assistant";
    return typeof text === "string" && text ? { role, content: text } : null;
  }
  return null;
}

/**
 * Read an agent transcript JSONL file and extract user/assistant messages.
 * Supports Claude Code's `{type:"user"|"assistant", message:{content}}` shape
 * and VS Code Copilot's `{type:"user.message"|"assistant.message", data:{content}}` shape.
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

/** Get the last user message from a messages array */
export function extractLastUser(messages: Message[]): Message | undefined {
  return messages.filter((m) => m.role === "user").pop();
}
