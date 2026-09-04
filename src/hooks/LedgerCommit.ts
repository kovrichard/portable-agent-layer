/**
 * Hook: PostToolUse — pairs the parked before-state with the result and writes
 * the ledger entry.
 *
 * Only a call that actually landed reaches this event, so every entry written
 * here is an applied one. A denied or failed call fires the snapshot half and
 * never this one, leaving its snapshot unclaimed — which is why claiming also
 * reaps the ones that were abandoned.
 *
 * Silent and fail-open, for the same reason as its other half.
 */

import { commitApplied, ledgeredCall } from "./lib/ledger-hook";
import { logDebug } from "./lib/log";
import { readStdinJSON } from "./lib/stdin";

try {
  const input = await readStdinJSON<Record<string, unknown>>();
  if (!input) process.exit(0);

  const call = ledgeredCall(input);
  if (!call) process.exit(0);

  const entry = commitApplied(call);
  if (!entry) process.exit(0);

  logDebug("LedgerCommit", `recorded ${entry.id} ${entry.tool} ${entry.target}`);
} catch {
  process.exit(0);
}
