/**
 * Stop handler: analyzes the session transcript for relationship signals
 * (preferences, frustrations, positives, milestones, AI actions) and
 * appends them to the daily relationship note file.
 */

import { parseMessages } from "../lib/transcript";
import { analyzeTranscript, appendNotes } from "../lib/relationship";

export async function captureRelationship(transcript: string): Promise<void> {
  const messages = parseMessages(transcript);
  if (messages.length < 2) return;

  const notes = analyzeTranscript(messages);
  appendNotes(notes);
}
