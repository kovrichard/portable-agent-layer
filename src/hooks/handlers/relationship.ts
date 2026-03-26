/**
 * Stop handler: extracts relationship observations via Haiku inference.
 * Only runs on substantial sessions (≥10 messages).
 * Dedup: skips if this session already has notes in today's file.
 */

import { inference } from "../lib/inference";
import { logDebug, logError } from "../lib/log";
import { appendNotes, hasSessionNotes, type RelationshipNote } from "../lib/relationship";
import { logTokenUsage } from "../lib/token-usage";
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
            enum: ["O", "W", "B"],
            description:
              "O=opinion/preference, W=factual observation, B=biographical (what the AI did this session)",
          },
          text: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["type", "text", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["observations"],
  additionalProperties: false,
} as const;

export async function captureRelationship(
  transcript: string,
  sessionId?: string
): Promise<void> {
  if (sessionId && hasSessionNotes(sessionId)) {
    logDebug("relationship", "Skipped: session already has notes");
    return;
  }

  const messages = parseMessages(transcript);
  logDebug("relationship", `Messages: ${messages.length}`);
  if (messages.length < 10) {
    logDebug("relationship", "Skipped: < 10 messages");
    return;
  }

  if (!process.env.PAL_ANTHROPIC_API_KEY) {
    logDebug("relationship", "Skipped: no PAL_ANTHROPIC_API_KEY");
    return;
  }

  // Collect user messages for analysis
  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => extractContent(m))
    .filter((t) => t.length > 0)
    .slice(-15)
    .map((t) => t.slice(0, 200));

  logDebug("relationship", `User messages: ${userMessages.length}`);
  if (userMessages.length < 3) {
    logDebug("relationship", "Skipped: < 3 user messages");
    return;
  }

  logDebug("relationship", "Calling inference...");
  const result = await inference({
    system:
      "You analyze messages from an AI coding session to extract relationship observations. " +
      "Types: O=opinions/preferences (how the user likes to work, what they want), " +
      "B=biographical (what the AI accomplished this session, written in first-person), " +
      "W=world facts (user's situation, projects, tools they use). " +
      "Focus on: preferences, corrections, frustrations, positive reactions, communication style, and session accomplishments. " +
      "Return 0-3 observations. If nothing notable, return empty observations array. Be concise.",
    user: `User messages from this session:\n${userMessages.map((m, i) => `${i + 1}. ${m}`).join("\n")}`,
    maxTokens: 300,
    timeout: 8000,
    jsonSchema: OBSERVATION_SCHEMA,
  });

  if (result.usage) logTokenUsage("relationship", result.usage);

  logDebug("relationship", `Inference result: success=${result.success}`);
  if (!result.success || !result.output) {
    logDebug("relationship", "Skipped: inference failed or empty output");
    return;
  }

  try {
    const parsed = JSON.parse(result.output) as {
      observations: Array<{ type: "O" | "W" | "B"; text: string; confidence: number }>;
    };

    logDebug("relationship", `Parsed ${parsed.observations?.length ?? 0} observations`);
    if (!parsed.observations || parsed.observations.length === 0) return;

    const notes: RelationshipNote[] = parsed.observations.map((o) => ({
      type: o.type,
      text: o.text,
      confidence: o.confidence,
    }));

    appendNotes(notes, sessionId);
    logDebug("relationship", `Captured ${notes.length} observations via inference`);
  } catch (err) {
    logError("relationship", err);
  }
}
