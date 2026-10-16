/**
 * A correction that asks the assistant to stop a behavior the user once praised.
 * The reinforcement is flagged, never retired: only the user ends it, and the
 * flag puts the praise and the correction side by side in pal cli rule list.
 */

import type { AdaptationRule } from "./adaptation-rules";

const CONFLICT_SYSTEM = `An AI assistant keeps a list of behaviors the user once praised. The user has now corrected one of its replies. Decide whether the correction tells the assistant to stop, reverse or tone down one of those behaviors.

Answer with that behavior's id only when the correction is about that same behavior, such as "stop arguing, just do it" against a behavior of arguing back. A correction about a fact, a missed request or anything else names no behavior: answer an empty string.`;

const CONFLICT_SCHEMA = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
  additionalProperties: false,
} as const;

const MESSAGE_MAX = 800;

function behaviorLines(kept: AdaptationRule[]): string {
  return kept.map((rule) => `- ${rule.id}: ${rule.when}: ${rule.steering}`).join("\n");
}

export function conflictRequest(
  message: string,
  issue: string,
  kept: AdaptationRule[],
  sessionId?: string
) {
  return {
    system: CONFLICT_SYSTEM,
    user: `The praised behaviors:\n${behaviorLines(kept)}\n\nThe user's correction:\n<message>\n${message.slice(0, MESSAGE_MAX)}\n</message>\n\nWhat the reply got wrong:\n<issue>\n${issue}\n</issue>`,
    maxTokens: 100,
    timeout: 90_000,
    jsonSchema: CONFLICT_SCHEMA,
    caller: "reinforcement-conflict",
    sessionId,
  };
}

export function parseConflict(
  output: string | null | undefined,
  kept: AdaptationRule[]
): AdaptationRule | null {
  if (!output) return null;
  try {
    const { id } = JSON.parse(output) as { id?: unknown };
    return kept.find((rule) => rule.id === id) ?? null;
  } catch {
    return null;
  }
}
