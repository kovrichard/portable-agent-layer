/**
 * Hook: PostToolUseFailure and PermissionDenied — records an edit that was
 * attempted and did not land.
 *
 * A log that keeps only what succeeded cannot answer what was attempted, and
 * that is usually the question being asked of it. So the two endings that are
 * not success are recorded too, and kept apart: `failed` is the tool's own
 * attempt breaking, `denied` is something refusing to let it run.
 *
 * One hook serves both events because they differ only in which key carries the
 * reason — a difference `unappliedVerdictOf` owns, so registering this on a
 * third such event later is a line in that table rather than a new file.
 *
 * Not everything that fails to land reaches here. A manual denial at the
 * permission dialog, a `deny` rule, and a PreToolUse hook's own block all fire
 * PreToolUse and nothing after it; a schema rejection fires no hook at all.
 * Those attempts leave a snapshot no half ever claims, which is what the reaper
 * in ledger.ts is for.
 *
 * Silent and fail-open, for the same reason as the other halves.
 */

import { reapStalePending } from "./lib/ledger";
import { commitUnapplied, ledgeredCalls, unappliedVerdictOf } from "./lib/ledger-hook";
import { logDebug } from "./lib/log";
import { readStdinJSON } from "./lib/stdin";

try {
  const input = await readStdinJSON<Record<string, unknown>>();
  if (!input) process.exit(0);

  const calls = ledgeredCalls(input);
  const verdict = calls.length > 0 && unappliedVerdictOf(input);
  if (!verdict) process.exit(0);

  for (const call of calls) {
    const entry = commitUnapplied(call, verdict);
    logDebug("LedgerUnapplied", `recorded ${entry.id} ${entry.outcome} ${entry.target}`);
  }

  reapStalePending();
} catch {
  process.exit(0);
}
