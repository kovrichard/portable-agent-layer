/**
 * Stop handler: captures a learning signal from the session transcript.
 */

import { emitLearning } from "../lib/signals";
import { parseMessages, extractLastAssistant, extractContent } from "../lib/transcript";

export async function captureLearning(transcript: string): Promise<void> {
  const messages = parseMessages(transcript);

  if (messages.length > 0) {
    const lastAssistant = extractLastAssistant(messages);
    if (!lastAssistant) return;

    const summary = extractContent(lastAssistant).slice(0, 300);
    emitLearning(summary, "session");
  } else {
    // Transcript wasn't JSON — just log a basic signal
    emitLearning(transcript.slice(0, 300), "session");
  }
}
