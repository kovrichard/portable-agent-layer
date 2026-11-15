/**
 * Hook: PermissionRequest and Notification — logs that the agent is waiting on
 * the user. Logging only: it prints nothing, so it never answers the prompt, and
 * always exits 0.
 */

import { enterHookWorkspace } from "../core/hook-payload";
import { isPalSpawnedInference } from "../core/spawn-guard";
import { logAttention } from "../usage/attention-events";
import { recordHookRunOnExit } from "../usage/hook-run";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { readStdinJSON } from "./lib/stdin";

recordHookRunOnExit();

if (isPalSpawnedInference()) process.exit(0);

if (duplicatesCursorHooks()) process.exit(0);

try {
  const input = await readStdinJSON<Record<string, unknown>>();
  enterHookWorkspace(input);
  logAttention(input);
} catch {
  process.exit(0);
}
