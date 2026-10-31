/**
 * Hook: PreToolUse — Guards against dangerous commands.
 * Emits the current agent's deny response to block, or exits silently to allow.
 *
 * Fail-open design: if anything goes wrong, the command is allowed through.
 *
 * The decision itself is in lib/security-gate.ts, where a test can import it.
 */

import { blockResponse } from "./lib/agent";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { enterHookWorkspace } from "./lib/hook-turn";
import { recordBlocked } from "./lib/ledger";
import { logError } from "./lib/log";
import { decideRefusal, type SecurityInput } from "./lib/security-gate";
import { readStdinJSON } from "./lib/stdin";

if (duplicatesCursorHooks()) process.exit(0);

try {
  const input = await readStdinJSON<SecurityInput>();
  if (!input) process.exit(0);

  enterHookWorkspace(input);
  const refusal = decideRefusal(input, process.cwd());
  if (!refusal) process.exit(0);

  process.stdout.write(blockResponse(refusal.message, refusal.hookEventName));

  // Own try/catch, after the deny: a throwing ledger must not turn a block into an allow.
  try {
    recordBlocked(refusal);
  } catch (err) {
    logError("SecurityValidator:ledger", err);
  }
} catch {
  process.exit(0);
}
