/**
 * Hook: Stop — Single entry point for all stop-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * stdin: JSON object with { session_id, transcript_path, last_assistant_message, ... }
 */

import {
  type AntigravityStopFields,
  isSideStop,
  withTranscriptReply,
} from "../bronze/antigravity-transcript";
import { recordIdleCompactionNear } from "../context/compaction-near";
import { stopBlockResponse } from "../core/agent";
import {
  enterHookWorkspace,
  hookFinalReply,
  type StopTurnPayload,
} from "../core/hook-payload";
import { logError } from "../core/log";
import { isPalSpawnedInference } from "../core/spawn-guard";
import { replySendBack } from "../opinions/reply-checks";
import { stopProgressTree } from "../progress/progress-tree-stop";
import { runStopReason } from "../safety/run-mode-gate";
import { recordHookRunOnExit } from "../usage/hook-run";
import { checkReadmeSync } from "./handlers/readme-sync";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { readStdinJSON } from "./lib/stdin";
import { stopTurn } from "./lib/stop";

recordHookRunOnExit();

if (isPalSpawnedInference()) process.exit(0);

if (duplicatesCursorHooks()) process.exit(0);

const received = await readStdinJSON<StopTurnPayload & AntigravityStopFields>();
if (isSideStop(received)) process.exit(0);
const payload = withTranscriptReply(received);
enterHookWorkspace(payload);
recordIdleCompactionNear(payload);

// First: it reads only git and PRs, so every stop attempt attaches new commits, even one a block below refuses.
try {
  stopProgressTree(payload);
} catch (err) {
  logError("StopOrchestrator:progress-tree", err);
}

// Fix requests before keep-working: the README first, as it blocks every attempt, then reply checks, claims before style.
try {
  const decision = await checkReadmeSync();
  if (decision.decision === "block" && decision.reason) {
    process.stdout.write(stopBlockResponse(decision.reason));
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:readme-sync", err);
}

try {
  const sendBack = replySendBack(payload);
  if (sendBack) {
    process.stdout.write(stopBlockResponse(sendBack));
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:reply-checks", err);
}

try {
  const keepGoing = runStopReason(process.cwd(), hookFinalReply(payload) ?? "");
  if (keepGoing) {
    process.stdout.write(stopBlockResponse(keepGoing));
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:run-mode", err);
}

// Last: it writes to the terminal and starts inference, which only a stop that really ends may do.
await stopTurn(payload);
