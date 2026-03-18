/**
 * Stop handler: sends a desktop notification and optional voice announcement.
 */

import { desktopNotify, speak } from "../lib/notify";

export async function notifyCompletion(transcript: string): Promise<void> {
  desktopNotify("PAI", "Session completed");

  // Voice: try to extract a short summary
  try {
    const messages = JSON.parse(transcript);
    if (!Array.isArray(messages)) return;

    const lastAssistant = messages
      .filter((m: { role: string }) => m.role === "assistant")
      .pop();

    if (lastAssistant) {
      const content =
        typeof lastAssistant.content === "string" ? lastAssistant.content : "";
      // First sentence only
      const firstSentence = content.split(/[.!?]\s/)[0] || "Done";
      speak(firstSentence);
    }
  } catch {
    speak("Session completed");
  }
}
