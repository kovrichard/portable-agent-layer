/**
 * UserPromptSubmit handler: generates a 4-word name for the session on the
 * first prompt. Subsequent prompts in the same session are skipped.
 */

import { readSessionNames, writeSessionName, extractFallbackName } from "../lib/session-names";
import { inference } from "../lib/inference";

export async function captureSessionName(
  message: string,
  sessionId: string
): Promise<void> {
  if (!sessionId) return;

  // Skip if this session is already named
  const names = readSessionNames();
  if (names[sessionId]) return;

  const result = await inference({
    system:
      "You generate concise 4-word session titles for AI coding sessions. " +
      "Respond with ONLY 4 words, lowercase, no punctuation.",
    user: `Generate a 4-word title for a session starting with: "${message.slice(0, 200)}"`,
    maxTokens: 20,
    timeout: 4000,
  });

  const name =
    result.success && result.output
      ? result.output.trim().slice(0, 60)
      : extractFallbackName(message);

  writeSessionName(sessionId, name);
}
