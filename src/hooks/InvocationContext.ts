/**
 * Hook: PreInvocation (Antigravity) — injects the session context once per
 * conversation and the prompt context once per turn.
 *
 * Silent and fail-open: anything that goes wrong prints nothing. What to inject
 * is decided in lib/invocation-context.ts, where a test can import it.
 */

import { enterHookWorkspace } from "./lib/hook-turn";
import { type InvocationPayload, invocationContext } from "./lib/invocation-context";
import { logError } from "./lib/log";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

if (isPalSpawnedInference()) process.exit(0);

try {
  const input = await readStdinJSON<InvocationPayload>();
  if (!input) process.exit(0);

  enterHookWorkspace(input);
  const reply = await invocationContext(input);
  if (reply) process.stdout.write(reply);
} catch (err) {
  logError("InvocationContext", err);
}
