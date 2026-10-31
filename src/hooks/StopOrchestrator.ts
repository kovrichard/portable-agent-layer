/**
 * Hook: Stop — Single entry point for all stop-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * stdin: JSON object with { session_id, transcript_path, last_assistant_message, ... }
 */

import { checkReadmeSync } from "./handlers/readme-sync";
import { stopBlockResponse } from "./lib/agent";
import {
  type AntigravityStopFields,
  isSideStop,
  withTranscriptReply,
} from "./lib/antigravity-transcript";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { enterHookWorkspace } from "./lib/hook-turn";
import { logError } from "./lib/log";
import { stopProgressTree } from "./lib/progress-tree-stop";
import { replySendBack } from "./lib/reply-checks";
import { unattendedStopReason } from "./lib/run-mode-gate";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";
import { type StopTurnPayload, stopTurn } from "./lib/stop";

if (isPalSpawnedInference()) process.exit(0);
if (duplicatesCursorHooks()) process.exit(0);

const received = await readStdinJSON<StopTurnPayload & AntigravityStopFields>();
if (isSideStop(received)) process.exit(0);
const payload = withTranscriptReply(received);
enterHookWorkspace(payload);

// First: it reads only git and PRs, so every stop attempt attaches new commits, even one a block below refuses.
try {
  stopProgressTree(payload);
} catch (err) {
  logError("StopOrchestrator:progress-tree", err);
}

// Fix requests come before the keep-working block; the README first, as it blocks every attempt until fixed.
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

// Reply checks next, claims before style rules: one send-back per reply, so the corrected reply goes through.
try {
  const sendBack = replySendBack(payload);
  if (sendBack) {
    process.stdout.write(stopBlockResponse(sendBack));
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:reply-checks", err);
}
// After the reply checks: a reply that needs fixing goes back for the fix, not for the next task.
try {
  const keepGoing = unattendedStopReason(process.cwd());
  if (keepGoing) {
    process.stdout.write(stopBlockResponse(keepGoing));
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:unattended", err);
}
// Last: it writes to the terminal and starts inference, which only a stop that really ends may do.
await stopTurn(payload);
