/**
 * Hook: Stop — Single entry point for all stop-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * stdin: JSON object with { session_id, transcript_path, last_assistant_message, ... }
 * Transcript is read from the file at transcript_path, NOT from stdin.
 */

import { checkReadmeSync } from "./handlers/readme-sync";
import { isCursor } from "./lib/agent";
import { logError } from "./lib/log";
import { readStdinJSON } from "./lib/stdin";
import { runStopHandlers } from "./lib/stop";
import { readTranscriptFile } from "./lib/transcript";

interface StopHookInput {
  session_id: string;
  transcript_path: string;
  last_assistant_message?: string;
}

// Check README sync before anything else — may block the session
try {
  const decision = checkReadmeSync();
  if (decision.decision === "block") {
    if (isCursor()) {
      // Cursor stop hook: followup_message auto-sends to the agent
      process.stdout.write(JSON.stringify({ followup_message: decision.reason }));
    } else {
      // Claude Code: block decision
      process.stdout.write(JSON.stringify(decision));
    }
    process.exit(0);
  }
} catch (err) {
  logError("StopOrchestrator:readme-sync", err);
}

const input = await readStdinJSON<StopHookInput>();
if (!input?.transcript_path) {
  logError("StopOrchestrator", "No transcript_path in hook input");
  process.exit(0);
}

// Read the actual transcript from the file on disk
const messages = readTranscriptFile(input.transcript_path);
if (messages.length < 2) process.exit(0);

// Serialize and run handlers
const transcript = JSON.stringify(messages);
await runStopHandlers(transcript, {
  lastAssistantMessage: input.last_assistant_message,
  sessionId: input.session_id,
});
