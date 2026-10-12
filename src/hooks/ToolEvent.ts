/**
 * Hook: after every tool call, failed call and denied call — logs it as an event.
 * Logging only: it writes nothing to stdout and always exits 0.
 */

import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { enterHookWorkspace } from "./lib/hook-turn";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";
import { logToolCall } from "./lib/tool-events";

if (isPalSpawnedInference()) process.exit(0);
if (duplicatesCursorHooks()) process.exit(0);

try {
  const input = await readStdinJSON<Record<string, unknown>>();
  enterHookWorkspace(input);
  logToolCall(input);
} catch {
  process.exit(0);
}
