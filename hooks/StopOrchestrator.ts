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
import { existsSync, readFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { paths } from "./lib/paths";
import { captureWork } from "./handlers/work";
import { captureLearning } from "./handlers/learning";
import { notifyCompletion } from "./handlers/notify";
import { resetTab } from "./handlers/tab";
import { captureWisdom } from "./handlers/wisdom";
import { captureRelationship } from "./handlers/relationship";
import { captureWorkLearning } from "./handlers/work-learning";
import { captureFailure } from "./handlers/failure";

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
  captureRelationship(transcript),
  captureWorkLearning(transcript),
  checkPendingFailure(transcript),
]);

async function checkPendingFailure(transcript: string): Promise<void> {
  const pendingPath = resolve(paths.state(), "pending-failure.json");
  if (!existsSync(pendingPath)) return;

  try {
    const pending = JSON.parse(readFileSync(pendingPath, "utf-8")) as {
      rating: number;
      context: string;
    };
    unlinkSync(pendingPath);
    await captureFailure(pending.rating, pending.context, transcript);
  } catch {
    // Non-critical
  }
}
