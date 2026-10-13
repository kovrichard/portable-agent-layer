/**
 * Hook: PermissionRequest and Notification — logs that the agent is waiting on
 * the user. Logging only: it prints nothing, so it never answers the prompt, and
 * always exits 0.
 */

import { logAttention } from "./lib/attention-events";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { enterHookWorkspace } from "./lib/hook-turn";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

if (isPalSpawnedInference()) process.exit(0);
if (duplicatesCursorHooks()) process.exit(0);

try {
  const input = await readStdinJSON<Record<string, unknown>>();
  enterHookWorkspace(input);
  logAttention(input);
} catch {
  process.exit(0);
}
