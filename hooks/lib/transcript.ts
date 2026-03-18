/**
 * Shared transcript parsing utilities.
 * Used by Stop handlers and the opencode plugin.
 */

import { readFileSync } from "node:fs";

export interface Message {
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

/**
 * Read a Claude Code transcript JSONL file and extract user/assistant messages.
 * Each line is a JSON object; we extract entries with type "user" or "assistant".
 */
export function readTranscriptFile(path: string): Message[] {
  try {
    const content = readFileSync(path, "utf-8");
    const messages: Message[] = [];

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "user" || entry.type === "assistant") {
          const msg = entry.message ?? {};
          let text = "";
          if (typeof msg.content === "string") {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            text = msg.content
              .filter((c: { type: string }) => c.type === "text")
              .map((c: { text: string }) => c.text)
              .join(" ");
          }
          if (text) {
            messages.push({ role: entry.type, content: text });
          }
        }
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
