/**
 * Shared transcript parsing utilities.
 * Used by Stop handlers and the opencode plugin.
 */

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

/** Extract string content from a message object */
export function extractContent(msg: Message | undefined): string {
  if (!msg) return "";
  return typeof msg.content === "string"
    ? msg.content
    : JSON.stringify(msg.content);
}

/** Get the last assistant message from a messages array */
export function extractLastAssistant(messages: Message[]): Message | undefined {
  return messages.filter((m) => m.role === "assistant").pop();
}

/** Get the last user message from a messages array */
export function extractLastUser(messages: Message[]): Message | undefined {
  return messages.filter((m) => m.role === "user").pop();
}
