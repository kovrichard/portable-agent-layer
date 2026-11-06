/**
 * Stop handler: captures structured session records.
 * Replaces the old work.ts handler.
 */

import {
  extractFallbackName,
  readSessionNames,
  writeSessionName,
} from "../lib/session-names";
import { now } from "../lib/time";
import {
  extractContent,
  extractLastAssistant,
  extractLastUser,
  type Message,
  parseMessages,
  runningCount,
} from "../lib/transcript";
import {
  detectStatus,
  extractArtifacts,
  extractHandoff,
  readSession,
  type SessionRecord,
  writeSession,
} from "../lib/work-tracking";

function sessionLength(
  messages: Message[],
  previous: SessionRecord | undefined
): Pick<SessionRecord, "messageCount" | "lastMessageId"> {
  return {
    messageCount: runningCount(messages, previous?.messageCount, previous?.lastMessageId),
    lastMessageId: messages.at(-1)?.id,
  };
}

export async function captureWorkSession(
  transcript: string,
  sessionId?: string
): Promise<void> {
  try {
    const messages = parseMessages(transcript);
    if (messages.length < 2) return;

    const id = sessionId || `session-${Date.now()}`;

    // Name the session if still untitled and enough messages
    const names = readSessionNames();
    let name = names[id] || "";
    if ((!name || name === "untitled session") && messages.length >= 6) {
      const userTexts = messages
        .filter((m) => m.role === "user")
        .map((m) => extractContent(m))
        .join(" ");
      name = extractFallbackName(userTexts);
      if (name !== "untitled session") writeSessionName(id, name);
    }
    if (!name || name === "untitled session") name = "untitled session";

    // Extract content
    const lastUser = extractLastUser(messages);
    const lastAssistant = extractLastAssistant(messages);
    const lastAssistantText = extractContent(lastAssistant);
    const summary = extractContent(lastUser).slice(0, 300);

    const record: SessionRecord = {
      sessionId: id,
      name,
      ts: now(),
      cwd: process.cwd(),
      status: detectStatus(lastAssistantText),
      summary,
      artifacts: extractArtifacts(messages),
      handoff: extractHandoff(lastAssistantText),
      ...sessionLength(messages, readSession(id)),
    };

    writeSession(record);
  } catch {
    // Non-critical
  }
}
