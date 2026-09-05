/**
 * Hook: PreToolUse — parks the target file's current contents before an edit.
 *
 * This half exists because the other half cannot do its job alone. A post-tool
 * event fires once the file has already been rewritten, so the prior contents
 * are gone and "what changed" is unanswerable from it. Reading the file here,
 * before the tool runs, is the only moment the before-state still exists.
 *
 * Silent and fail-open: stdout is the agent's protocol channel, and a ledger
 * that could block an edit would be a worse thing than a ledger with a gap.
 */

import { ledgeredCalls, snapshotCall } from "./lib/ledger-hook";
import { logDebug } from "./lib/log";
import { readStdinJSON } from "./lib/stdin";

try {
  const input = await readStdinJSON<Record<string, unknown>>();
  if (!input) process.exit(0);

  const calls = ledgeredCalls(input);
  if (calls.length === 0) process.exit(0);

  for (const call of calls) {
    snapshotCall(call);
    logDebug("LedgerSnapshot", `captured ${call.tool} ${call.toolUseId}`);
  }
} catch {
  process.exit(0);
}
