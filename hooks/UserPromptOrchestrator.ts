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

interface PromptSubmitInput {
  message: string;
  session_id?: string;
}

const input = await readStdinJSON<PromptSubmitInput>();
if (!input?.message) process.exit(0);

await Promise.allSettled([
  captureRating(input.message),
  captureSessionName(input.message, input.session_id ?? ""),
]);
