/**
 * Hook: UserPromptSubmit — Single entry point for all prompt-event handling.
 * Fans out to independent handlers via Promise.allSettled.
 *
 * Handlers:
 *  - rating: capture explicit/implicit sentiment ratings
 *  - session-name: generate 4-word session headline on first prompt
 */

import { injectPromptContext } from "./handlers/inject-retrieval";
import { compactionWarningReminder, recordCompactionNear } from "./lib/compaction-near";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { recordHookRunOnExit } from "./lib/hook-run";
import { startHookTiming } from "./lib/hook-timing";
import { type HookTurnPayload, hookSessionId } from "./lib/hook-turn";
import { logDebug, logPromptSnapshot } from "./lib/log";
import { capturePrompt } from "./lib/prompt-capture";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

recordHookRunOnExit();

// Recursion guard — the "prompt" inside a spawned inference is the dispatcher's
// payload, not a real user message. Skip rating capture, session naming, etc.
if (isPalSpawnedInference()) process.exit(0);
if (duplicatesCursorHooks()) process.exit(0);

interface PromptSubmitInput extends HookTurnPayload {
  prompt: string;
  transcript_path?: string;
  cwd?: string;
}

const input = await readStdinJSON<PromptSubmitInput>();
logDebug("UserPromptOrchestrator", `Input: ${JSON.stringify(input).slice(0, 200)}`);
const compactionVerdict = recordCompactionNear(input, Boolean(input?.prompt));
if (!input?.prompt) process.exit(0);

const timing = startHookTiming("prompt");
const sentAt = new Date();
const sessionId = hookSessionId(input);
const injected = await timing.time("inject-context", () =>
  injectPromptContext(
    input.prompt,
    sessionId,
    compactionWarningReminder(compactionVerdict)
  )
);
logPromptSnapshot(input.prompt, injected);

await timing.time("capture", () =>
  capturePrompt(input.prompt, sessionId, sentAt, "UserPromptOrchestrator")
);
timing.log(sessionId);
