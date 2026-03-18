/**
 * Hook: UserPromptSubmit — Single entry point for all prompt-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * Handlers:
 *  - rating: capture explicit/implicit sentiment ratings
 *  - session-name: generate 4-word session headline on first prompt
 */

import { readStdinJSON } from "./lib/stdin";
import { captureRating } from "./handlers/rating";
import { captureSessionName } from "./handlers/session-name";
import { logDebug, logError } from "./lib/log";

interface PromptSubmitInput {
  prompt: string;
  session_id?: string;
}

const input = await readStdinJSON<PromptSubmitInput>();
logDebug("UserPromptOrchestrator", `Input: ${JSON.stringify(input).slice(0, 200)}`);
if (!input?.prompt) process.exit(0);

const results = await Promise.allSettled([
  captureRating(input.prompt),
  captureSessionName(input.prompt, input.session_id ?? ""),
]);

const handlerNames = ["rating", "session-name"];
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  if (r.status === "rejected") {
    logError(`UserPromptOrchestrator:${handlerNames[i]}`, r.reason);
  }
}
