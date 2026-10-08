/**
 * Hook: Stop — Single entry point for all stop-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * stdin: JSON object with { session_id, transcript_path, last_assistant_message, ... }
 */

import { checkReadmeSync } from "./handlers/readme-sync";
import { watchReplyRules } from "./lib/adaptation-steering";
import { stopBlockResponse } from "./lib/agent";
import {
  type AntigravityStopFields,
  isSideStop,
  withTranscriptReply,
} from "./lib/antigravity-transcript";
import { watchClaims } from "./lib/claim-log";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { enterHookWorkspace } from "./lib/hook-turn";
import { logError } from "./lib/log";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";
import { type StopTurnPayload, stopTurn } from "./lib/stop";

// Recursion guard — spawned inference subprocesses must not record session
// learning, ratings, or handoffs from their throwaway transcript.
if (isPalSpawnedInference()) process.exit(0);
if (duplicatesCursorHooks()) process.exit(0);

const received = await readStdinJSON<StopTurnPayload & AntigravityStopFields>();
if (isSideStop(received)) process.exit(0);
const payload = withTranscriptReply(received);
enterHookWorkspace(payload);

// Check README sync before anything else — may block the session
try {
  // A block carrying no reason stops the turn without telling the model why, so it
  // is worth less than not blocking at all — require the reason to raise one.
  const decision = await checkReadmeSync();
  if (decision.decision === "block" && decision.reason) {
    process.stdout.write(stopBlockResponse(decision.reason));
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:readme-sync", err);
}

try {
  const sendBack = watchClaims(payload);
  if (sendBack) {
    process.stdout.write(stopBlockResponse(sendBack));
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:claim-check", err);
}
try {
  const sendBack = watchReplyRules(payload);
  if (sendBack) {
    process.stdout.write(stopBlockResponse(sendBack));
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:adaptation-rules", err);
}
await stopTurn(payload);
