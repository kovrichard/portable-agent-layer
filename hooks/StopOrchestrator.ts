/**
 * Hook: Stop — Single entry point for all stop-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * stdin: JSON object with { session_id, transcript_path, last_assistant_message, ... }
 * Transcript is read from the file at transcript_path, NOT from stdin.
 *
 * Handlers:
 *  - learning: capture session learnings
 *  - work: save state for next session pickup
 *  - notify: desktop notification + optional voice
 *  - tab: reset terminal tab title
 */

import { readStdinJSON } from "./lib/stdin";
import { readTranscriptFile } from "./lib/transcript";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { resolve } from "path";
import { paths, ensureDir } from "./lib/paths";
import { captureWork } from "./handlers/work";
import { captureLearning } from "./handlers/learning";
import { notifyCompletion } from "./handlers/notify";
import { resetTab } from "./handlers/tab";
import { captureWisdom } from "./handlers/wisdom";
import { captureRelationship } from "./handlers/relationship";
import { captureWorkLearning } from "./handlers/work-learning";
import { captureFailure } from "./handlers/failure";
import { captureReflection } from "./handlers/reflection";
import { logError, logDebug } from "./lib/log";
import { extractContent, extractLastAssistant } from "./lib/transcript";

interface StopHookInput {
  session_id: string;
  transcript_path: string;
  last_assistant_message?: string;
}

const input = await readStdinJSON<StopHookInput>();
if (!input?.transcript_path) {
  logError("StopOrchestrator", "No transcript_path in hook input");
  process.exit(0);
}

// Read the actual transcript from the file on disk
const messages = readTranscriptFile(input.transcript_path);
if (messages.length < 2) process.exit(0);

// Serialize messages back to JSON array for handlers that use parseMessages()
const transcript = JSON.stringify(messages);

logDebug("StopOrchestrator", `Running handlers (${messages.length} messages from ${input.transcript_path})`);

// Cache last assistant response for RatingCapture to use on next prompt
cacheLastResponse(input, messages);

// Run all handlers concurrently — none should block the others
const results = await Promise.allSettled([
  captureLearning(transcript),
  captureWork(transcript),
  notifyCompletion(transcript),
  resetTab(),
  captureWisdom(transcript),
  captureRelationship(transcript),
  captureWorkLearning(transcript),
  captureReflection(transcript),
  checkPendingFailure(transcript),
]);

const handlerNames = [
  "learning", "work", "notify", "tab", "wisdom",
  "relationship", "work-learning", "reflection", "pending-failure",
];
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  if (r.status === "rejected") {
    logError(`StopOrchestrator:${handlerNames[i]}`, r.reason);
  }
}

/** Cache the last assistant response so RatingCapture knows what was rated */
function cacheLastResponse(hookInput: StopHookInput, msgs: typeof messages): void {
  try {
    // Prefer last_assistant_message from hook input if available
    let lastResponse = hookInput.last_assistant_message;
    if (!lastResponse) {
      const lastAssistant = extractLastAssistant(msgs);
      lastResponse = extractContent(lastAssistant);
    }
    if (!lastResponse) return;

    const cachePath = resolve(ensureDir(paths.state()), "last-response.txt");
    writeFileSync(cachePath, lastResponse.slice(0, 2000), "utf-8");
    logDebug("StopOrchestrator", "Cached last response for RatingCapture");
  } catch (err) {
    logError("StopOrchestrator:cacheLastResponse", err);
  }
}

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
