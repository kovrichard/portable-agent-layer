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

import { existsSync, readFileSync } from "node:fs";
import { savePending } from "./lib/ledger";
import { ledgeredCall } from "./lib/ledger-hook";
import { logDebug } from "./lib/log";
import { readStdinJSON } from "./lib/stdin";

try {
  const input = await readStdinJSON<Record<string, unknown>>();
  if (!input) process.exit(0);

  const call = ledgeredCall(input);
  if (!call) process.exit(0);

  savePending({
    ...call,
    // Absent rather than empty: a file that does not exist yet is a creation,
    // which is a different event from a write over an empty file.
    before: existsSync(call.target) ? readFileSync(call.target, "utf-8") : null,
    ts: new Date().toISOString(),
  });

  logDebug("LedgerSnapshot", `captured ${call.tool} ${call.toolUseId}`);
} catch {
  process.exit(0);
}
