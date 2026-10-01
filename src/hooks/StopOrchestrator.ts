/**
 * Hook: Stop — Single entry point for all stop-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * stdin: JSON object with { session_id, transcript_path, last_assistant_message, ... }
 */

import { checkReadmeSync } from "./handlers/readme-sync";
import { blockResponse, isCodex, isCursor } from "./lib/agent";
import { logError } from "./lib/log";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";
import { type StopTurnPayload, stopTurn } from "./lib/stop";

// Recursion guard — spawned inference subprocesses must not record session
// learning, ratings, or handoffs from their throwaway transcript.
if (isPalSpawnedInference()) process.exit(0);

// Check README sync before anything else — may block the session
try {
  // A block carrying no reason stops the turn without telling the model why, so it
  // is worth less than not blocking at all — require the reason to raise one.
  const decision = checkReadmeSync();
  if (decision.decision === "block" && decision.reason) {
    if (isCursor()) {
      // Cursor stop hook: followup_message auto-sends to the agent
      process.stdout.write(JSON.stringify({ followup_message: decision.reason }));
    } else if (isCodex()) {
      // Codex stop hook: additionalContext re-queues as next prompt
      process.stdout.write(JSON.stringify({ additionalContext: decision.reason }));
    } else {
      // Claude Code, the Copilot CLI and VS Code's own Copilot each read a
      // different stop-block shape; VS Code ignores the top-level keys entirely.
      process.stdout.write(blockResponse(decision.reason, "Stop"));
    }
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:readme-sync", err);
}

await stopTurn(await readStdinJSON<StopTurnPayload>());
