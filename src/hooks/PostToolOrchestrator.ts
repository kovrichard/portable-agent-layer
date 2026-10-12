/**
 * Hook: after a tool call, a failed call or a denied one. Silent and fail-open:
 * it prints nothing and always exits 0, so it can never disturb a turn.
 */

import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { enterHookWorkspace } from "./lib/hook-turn";
import { runPostToolHandlers } from "./lib/post-tool";
import { readStdinJSON } from "./lib/stdin";

if (duplicatesCursorHooks()) process.exit(0);

try {
  const input = await readStdinJSON<Record<string, unknown>>();
  if (!input) process.exit(0);
  enterHookWorkspace(input);
  runPostToolHandlers(input);
} catch {
  process.exit(0);
}
