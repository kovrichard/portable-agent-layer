/**
 * Hook: UserPromptSubmit — Single entry point for all prompt-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * Handlers:
 *  - rating: capture explicit/implicit sentiment ratings
 *  - session-name: generate 4-word session headline on first prompt
 */

import { injectPromptContext } from "./handlers/inject-retrieval";
import { captureRating } from "./handlers/rating";
import { captureSessionName } from "./handlers/session-name";
import { logDebug, logError, logPromptSnapshot } from "./lib/log";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

// Recursion guard — the "prompt" inside a spawned inference is the dispatcher's
// payload, not a real user message. Skip rating capture, session naming, etc.
if (isPalSpawnedInference()) process.exit(0);

interface PromptSubmitInput {
  prompt: string;
  session_id?: string;
  sessionId?: string; // Copilot sends this (camelCase) instead of session_id
  conversation_id?: string; // Cursor sends this instead of session_id
}

const input = await readStdinJSON<PromptSubmitInput>();
logDebug("UserPromptOrchestrator", `Input: ${JSON.stringify(input).slice(0, 200)}`);
if (!input?.prompt) process.exit(0);

const sessionId = input.session_id ?? input.sessionId ?? input.conversation_id;
const injected = await injectPromptContext(input.prompt);
logPromptSnapshot(input.prompt, injected);

const results = await Promise.allSettled([
  captureRating(input.prompt, sessionId),
  captureSessionName(input.prompt, sessionId ?? ""),
]);

const handlerNames = ["rating", "session-name"];
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  if (r.status === "rejected") {
    logError(`UserPromptOrchestrator:${handlerNames[i]}`, r.reason);
  }
}
