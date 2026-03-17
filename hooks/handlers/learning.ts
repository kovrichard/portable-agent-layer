/**
 * Stop handler: captures a learning signal from the session transcript.
 */

import { emitLearning } from "../lib/signals";

export async function captureLearning(transcript: string): Promise<void> {
  // Try to parse as JSON transcript
  try {
    const messages = JSON.parse(transcript);
    if (!Array.isArray(messages)) return;

    // Extract last assistant message as a rough summary
    const lastAssistant = messages
      .filter((m: any) => m.role === "assistant")
      .pop();

    if (!lastAssistant) return;

    const content =
      typeof lastAssistant.content === "string"
        ? lastAssistant.content
        : JSON.stringify(lastAssistant.content);

    const summary = content.slice(0, 300);
    emitLearning(summary, "session");
  } catch {
    // Transcript wasn't JSON — just log a basic signal
    emitLearning(transcript.slice(0, 300), "session");
  }
}
