/**
 * Stop handler: extracts relationship observations via Haiku inference.
 * Only runs on substantial sessions (≥10 messages).
 * Dedup: skips if this session already has notes in today's file.
 */

import { inference } from "../lib/inference";
import { logDebug } from "../lib/log";
import { appendNotes, hasSessionNotes, type RelationshipNote } from "../lib/relationship";
import { extractContent, parseMessages } from "../lib/transcript";

const OBSERVATION_SCHEMA = {
  type: "object",
  properties: {
    observations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["O", "W"],
            description: "O=opinion/preference, W=factual observation",
          },
          text: { type: "string", maxLength: 200 },
          confidence: { type: "number", minimum: 0.5, maximum: 1.0 },
        },
        required: ["type", "text", "confidence"],
      },
      maxItems: 3,
    },
  },
  required: ["observations"],
} as const;

export async function captureRelationship(
  transcript: string,
  sessionId?: string
): Promise<void> {
  if (sessionId && hasSessionNotes(sessionId)) return;

  const messages = parseMessages(transcript);
  // Only run on substantial sessions
  if (messages.length < 10) return;

  // No API key → skip silently
  if (!process.env.ANTHROPIC_API_KEY) return;

  // Collect user messages for analysis
  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => extractContent(m))
    .filter((t) => t.length > 0)
    .slice(-15)
    .map((t) => t.slice(0, 200));

  if (userMessages.length < 3) return;

  const result = await inference({
    system:
      "You analyze user messages from an AI coding session to extract relationship observations. " +
      "Focus on: preferences (how they like to work), corrections (what they pushed back on), " +
      "frustrations, positive reactions, communication style patterns. " +
      "Return 0-3 observations. If nothing notable, return empty observations array. Be concise.",
    user: `User messages from this session:\n${userMessages.map((m, i) => `${i + 1}. ${m}`).join("\n")}`,
    maxTokens: 300,
    timeout: 8000,
    jsonSchema: OBSERVATION_SCHEMA,
  });

  if (!result.success || !result.output) return;

  try {
    const parsed = JSON.parse(result.output) as {
      observations: Array<{ type: "O" | "W"; text: string; confidence: number }>;
    };

    if (!parsed.observations || parsed.observations.length === 0) return;

    const notes: RelationshipNote[] = parsed.observations.map((o) => ({
      type: o.type,
      text: o.text,
      confidence: o.confidence,
    }));

    appendNotes(notes, sessionId);
    logDebug("relationship", `Captured ${notes.length} observations via inference`);
  } catch {
    // Non-critical
  }
}
