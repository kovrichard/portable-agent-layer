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
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { enterHookWorkspace } from "./lib/hook-turn";
import { logDebug, logError } from "./lib/log";
import { runModeRecall } from "./lib/run-mode-gate";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

if (isPalSpawnedInference()) process.exit(0);
if (duplicatesCursorHooks()) process.exit(0);

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

  enterHookWorkspace(input);
  const sessionId = input?.session_id;
  const run = runModeRecall(process.cwd());
  const file = findSavedExchange(sessionId);
  if (!file && !run) {
    logDebug("CompactRecover", "No saved exchange or run found — silent no-op");
    process.exit(0);
  }

  const exchange = file
    ? buildRecall(JSON.parse(await readFile(file, "utf-8")) as SavedExchange)
    : "";
  const out = [run, exchange].filter(Boolean).join("\n\n");
  process.stdout.write(isCursor() ? JSON.stringify({ additional_context: out }) : out);
  logDebug(
    "CompactRecover",
    `Re-injected ${out.length} chars from ${file ?? "run mode"}`
  );

  if (file && isConsumable(file, sessionId)) await unlink(file);
} catch (err) {
  logError("CompactRecover", err);
}

process.exit(0);
