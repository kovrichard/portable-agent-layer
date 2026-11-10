/**
 * Hook: afterAgentResponse (Cursor) — files the final reply against the turn it
 * answered. Cursor's stop event carries no reply, this one does.
 */

import { recordHookRunOnExit } from "./lib/hook-run";
import { fileFinalReply, type HookTurnPayload } from "./lib/hook-turn";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

recordHookRunOnExit();

if (isPalSpawnedInference()) process.exit(0);

fileFinalReply(await readStdinJSON<HookTurnPayload>());
