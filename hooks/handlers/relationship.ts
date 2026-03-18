/**
 * Stop handler: analyzes the session transcript for relationship signals
 * (preferences, frustrations, positives, milestones, AI actions) and
 * appends them to the daily relationship note file.
 *
 * Dedup: skips if this session already has notes in today's file.
 */

import { analyzeTranscript, appendNotes, hasSessionNotes } from "../lib/relationship";
import { parseMessages } from "../lib/transcript";

export async function captureRelationship(
  transcript: string,
  sessionId?: string
): Promise<void> {
  // Skip if we already wrote notes for this session
  if (sessionId && hasSessionNotes(sessionId)) return;

  const messages = parseMessages(transcript);
  if (messages.length < 2) return;

  const notes = analyzeTranscript(messages);
  appendNotes(notes, sessionId);
}
