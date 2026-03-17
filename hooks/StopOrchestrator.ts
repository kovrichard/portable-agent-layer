/**
 * Hook: Stop — Single entry point for all stop-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * Handlers:
 *  - learning: capture session learnings
 *  - work: save state for next session pickup
 *  - notify: desktop notification + optional voice
 *  - tab: reset terminal tab title
 */

import { readStdin } from "./lib/stdin";
import { captureWork } from "./handlers/work";
import { captureLearning } from "./handlers/learning";
import { notifyCompletion } from "./handlers/notify";
import { resetTab } from "./handlers/tab";
import { captureWisdom } from "./handlers/wisdom";

const transcript = await readStdin();

// Skip trivial sessions
if (transcript.length < 100) process.exit(0);

// Run all handlers concurrently — none should block the others
await Promise.allSettled([
  captureLearning(transcript),
  captureWork(transcript),
  notifyCompletion(transcript),
  resetTab(),
  captureWisdom(transcript),
]);
