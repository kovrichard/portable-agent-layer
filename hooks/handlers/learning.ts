/**
 * Stop handler: captures a learning signal from the session transcript.
 * Dedup: only emits once per session ID.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "../lib/paths";
import { emitLearning } from "../lib/signals";
import { extractContent, extractLastAssistant, parseMessages } from "../lib/transcript";

/** Check if we already emitted a learning for this session */
function alreadyEmitted(sessionId: string): boolean {
  const filepath = resolve(paths.signals(), "learnings.jsonl");
  if (!existsSync(filepath)) return false;
  try {
    // Check last 20 lines for this session ID
    const lines = readFileSync(filepath, "utf-8").trim().split("\n").slice(-20);
    return lines.some((l) => l.includes(sessionId));
  } catch {
    return false;
  }
}

export async function captureLearning(
  transcript: string,
  sessionId?: string
): Promise<void> {
  if (sessionId && alreadyEmitted(sessionId)) return;

  const messages = parseMessages(transcript);
  if (messages.length < 4) return;

  const lastAssistant = extractLastAssistant(messages);
  if (!lastAssistant) return;

  const summary = extractContent(lastAssistant).slice(0, 300);
  emitLearning(summary, "session", sessionId);
}
