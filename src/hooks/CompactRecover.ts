/**
 * Hook: SessionStart(compact) — re-injects the exchange that was in flight when
 * the window filled, since the summary may have collapsed it.
 *
 * What to inject and what may then be deleted is in lib/compact-recall.ts, where
 * a test can import it.
 */

import { readFile, unlink } from "node:fs/promises";
import { isCursor } from "./lib/agent";
import {
  buildRecall,
  findSavedExchange,
  isConsumable,
  type SavedExchange,
} from "./lib/compact-recall";
import { logDebug, logError } from "./lib/log";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

// Recursion guard — spawned subprocesses don't compact, so nothing to recover.
if (isPalSpawnedInference()) process.exit(0);

interface SessionStartInput {
  session_id?: string;
  hook_event_name?: string;
  source?: "startup" | "resume" | "clear" | "compact" | string;
}

try {
  const input = await readStdinJSON<SessionStartInput>();

  // The matcher gates this hook to "compact" sessions, but verify defensively in
  // case the matcher is misconfigured or the hook is invoked manually.
  if (input?.source && input.source !== "compact") {
    logDebug("CompactRecover", `source=${input.source} — not compact, skipping`);
    process.exit(0);
  }

  const sessionId = input?.session_id;
  const file = findSavedExchange(sessionId);
  if (!file) {
    logDebug("CompactRecover", "No saved exchange found — silent no-op");
    process.exit(0);
  }

  const saved = JSON.parse(await readFile(file, "utf-8")) as SavedExchange;
  const out = buildRecall(saved);
  process.stdout.write(isCursor() ? JSON.stringify({ additional_context: out }) : out);
  logDebug("CompactRecover", `Re-injected ${out.length} chars from ${file}`);

  if (isConsumable(file, sessionId)) await unlink(file);
} catch (err) {
  logError("CompactRecover", err);
}

process.exit(0);
