/**
 * Hook: PreInvocation (Antigravity) — injects the session context once per
 * conversation and the prompt context once per turn.
 *
 * Silent and fail-open: anything that goes wrong prints nothing. What to inject
 * is decided in lib/invocation-context.ts, where a test can import it.
 */

import { enterHookWorkspace } from "../core/hook-payload";
import { logError } from "../core/log";
import { isPalSpawnedInference } from "../core/spawn-guard";
import { recordHookRunOnExit } from "../usage/hook-run";
import { type InvocationPayload, invocationContext } from "./lib/invocation-context";
import { readStdinJSON } from "./lib/stdin";

recordHookRunOnExit();

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
