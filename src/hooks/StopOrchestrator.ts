/**
 * Hook: Stop — Single entry point for all stop-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * stdin: JSON object with { session_id, transcript_path, last_assistant_message, ... }
 * Transcript is read from the file at transcript_path, NOT from stdin.
 */

import { checkReadmeSync } from "./handlers/readme-sync";
import { blockResponse, isCodex, isCursor } from "./lib/agent";
import { logError } from "./lib/log";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";
import { runStopHandlers } from "./lib/stop";
import { readTranscriptFile } from "./lib/transcript";

// Recursion guard — spawned inference subprocesses must not record session
// learning, ratings, or handoffs from their throwaway transcript.
if (isPalSpawnedInference()) process.exit(0);

interface StopHookInput {
  session_id?: string;
  sessionId?: string; // Copilot uses camelCase
  transcript_path?: string;
  transcriptPath?: string; // Copilot uses camelCase
  last_assistant_message?: string;
  lastAssistantMessage?: string; // Copilot uses camelCase
}

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

const input = await readStdinJSON<StopHookInput>();
const transcriptPath = input?.transcript_path ?? input?.transcriptPath;
const sessionId = input?.session_id ?? input?.sessionId;
const lastAssistant = input?.last_assistant_message ?? input?.lastAssistantMessage;

if (!transcriptPath) {
  logError("StopOrchestrator", "No transcript_path in hook input");
  process.exit(0);
}

// Read the actual transcript from the file on disk
const messages = readTranscriptFile(transcriptPath);
if (messages.length < 2) process.exit(0);

// Serialize and run handlers
const transcript = JSON.stringify(messages);
await runStopHandlers(transcript, {
  lastAssistantMessage: lastAssistant,
  sessionId,
});
