/**
 * Hook: PreToolUse — Guards against dangerous commands.
 * Emits the current agent's deny response to block, or exits silently to allow.
 *
 * Fail-open design: if anything goes wrong, the command is allowed through.
 *
 * The decision itself is in lib/security-gate.ts, where a test can import it.
 */

import { blockResponse } from "./lib/agent";
import { recordBlocked } from "./lib/ledger";
import { logError } from "./lib/log";
import { decideRefusal, type SecurityInput } from "./lib/security-gate";
import { readStdinJSON } from "./lib/stdin";

try {
  const input = await readStdinJSON<SecurityInput>();
  if (!input) process.exit(0);

  const refusal = decideRefusal(input, process.cwd());
  if (!refusal) process.exit(0);

  process.stdout.write(blockResponse(refusal.message, refusal.hookEventName));

  // After the deny has gone out, in its own try/catch: this hook is fail-open,
  // and a ledger that threw on its way to recording a block would turn the
  // block into an allow.
  try {
    recordBlocked(refusal);
  } catch (err) {
    logError("SecurityValidator:ledger", err);
  }
} catch {
  // Fail open
  process.exit(0);
}
