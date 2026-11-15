/**
 * Hook: afterAgentResponse (Cursor) — files the final reply against the turn it
 * answered. Cursor's stop event carries no reply, this one does.
 */

import type { HookTurnPayload } from "../core/hook-payload";
import { isPalSpawnedInference } from "../core/spawn-guard";
import { recordHookRunOnExit } from "../usage/hook-run";
import { fileFinalReply } from "./lib/hook-turn";
import { readStdinJSON } from "./lib/stdin";

recordHookRunOnExit();

if (isPalSpawnedInference()) process.exit(0);

fileFinalReply(await readStdinJSON<HookTurnPayload>());
