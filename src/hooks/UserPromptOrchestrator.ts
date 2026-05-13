/**
 * Hook: UserPromptSubmit — Single entry point for all prompt-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * Handlers:
 *  - rating: capture explicit/implicit sentiment ratings
 *  - session-name: generate 4-word session headline on first prompt
 */

import { injectRetrieval } from "./handlers/inject-retrieval";
import { captureRating } from "./handlers/rating";
import { captureSessionName } from "./handlers/session-name";
import { logDebug, logError } from "./lib/log";
import { readStdinJSON } from "./lib/stdin";

interface PromptSubmitInput {
  prompt: string;
  session_id?: string;
  conversation_id?: string; // Cursor sends this instead of session_id
}

const input = await readStdinJSON<PromptSubmitInput>();
logDebug("UserPromptOrchestrator", `Input: ${JSON.stringify(input).slice(0, 200)}`);
if (!input?.prompt) process.exit(0);

const sessionId = input.session_id ?? input.conversation_id;
const results = await Promise.allSettled([
  captureRating(input.prompt, sessionId),
  captureSessionName(input.prompt, sessionId ?? ""),
  injectRetrieval(input.prompt),
]);

const handlerNames = ["rating", "session-name", "inject-retrieval"];
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  if (r.status === "rejected") {
    logError(`UserPromptOrchestrator:${handlerNames[i]}`, r.reason);
  }
}
