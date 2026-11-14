/**
 * What every prompt hook records about the prompt itself, whichever event the
 * agent delivers it on. Each handler is independent, so one failing is logged
 * and never stops the other.
 */

import { logError } from "../../core/log";
import { captureRating } from "../handlers/rating";
import { captureSessionName } from "../handlers/session-name";

const HANDLER_NAMES = ["rating", "session-name"];

export async function capturePrompt(
  prompt: string,
  sessionId: string | undefined,
  sentAt: Date,
  caller: string
): Promise<void> {
  const results = await Promise.allSettled([
    captureRating(prompt, sessionId, sentAt),
    captureSessionName(prompt, sessionId ?? ""),
  ]);
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      logError(`${caller}:${HANDLER_NAMES[i]}`, result.reason);
    }
  });
}
