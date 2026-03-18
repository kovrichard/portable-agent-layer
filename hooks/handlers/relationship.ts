/**
 * Stop handler: analyzes the session transcript for relationship signals
 * (preferences, frustrations, positives, milestones, AI actions) and
 * appends them to the daily relationship note file.
 */

import { analyzeTranscript, appendNotes } from "../lib/relationship";
import { parseMessages } from "../lib/transcript";

export async function captureRelationship(transcript: string): Promise<void> {
  const messages = parseMessages(transcript);
  if (messages.length < 2) return;

  const notes = analyzeTranscript(messages);
  appendNotes(notes);
}
