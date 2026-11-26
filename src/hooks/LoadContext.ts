/**
 * Hook: SessionStart — Injects dynamic context + regenerates AGENTS.md if stale.
 *
 * Static context (TELOS, setup prompt) loads natively from AGENTS.md / CLAUDE.md;
 * this hook injects only the dynamic part: progress tree, opinions, work state.
 * Which agent gets what, in which envelope, is in src/context/session-context.ts.
 */

import { buildClaudeMd, regenerateIfNeeded } from "../context/claude-md";
import { buildSystemReminder } from "../context/context";
import { logContextInjected } from "../context/context-overhead";
import {
  contextEnvelope,
  contextForSource,
  isSubagentSession,
  needsAgentsMd,
  reminderTarget,
  writeCopilotInstructions,
} from "../context/session-context";
import { refreshCachesOnStart } from "../context/start-refresh";
import { getActiveAgent } from "../core/agent";
import { hookSessionId } from "../core/hook-payload";
import { logContextSnapshot, logDebug, logError } from "../core/log";
import { isPalSpawnedInference } from "../core/spawn-guard";
import { recordHookRunOnExit } from "../usage/hook-run";
import { logSessionStart, type SessionStartPayload } from "../usage/session-events";
import { autoUpdateOnStart } from "./lib/auto-update";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { readStdinJSON } from "./lib/stdin";
import { heartbeatOnStart } from "./lib/telemetry";

recordHookRunOnExit();

if (isPalSpawnedInference()) process.exit(0);

if (duplicatesCursorHooks()) process.exit(0);

if (isSubagentSession(process.env)) {
  logDebug("LoadContext", "Subagent session — skipping context loading");
  process.exit(0);
}

try {
  if (regenerateIfNeeded()) logDebug("LoadContext", "AGENTS.md regenerated");
} catch (err) {
  logError("LoadContext:regenerate", err);
}

try {
  if (autoUpdateOnStart()) logDebug("LoadContext", "close hook silent — updating now");
} catch (err) {
  logError("LoadContext:auto-update", err);
}

heartbeatOnStart();
refreshCachesOnStart();

try {
  const active = getActiveAgent();
  const input = await readStdinJSON<SessionStartPayload>();
  logSessionStart(input);
  const wanted = contextForSource(active, input?.source);
  if (wanted === "none") {
    logDebug("LoadContext", `source=${input?.source}, context already present`);
    process.exit(0);
  }

  const reminder = buildSystemReminder({
    agent: reminderTarget(active),
    sessionId: hookSessionId(input),
  });
  if (!reminder) process.exit(0);
  logContextSnapshot(reminder);

  const envelope = contextEnvelope(
    active,
    reminder,
    needsAgentsMd(active) ? buildClaudeMd() : ""
  );
  if (!envelope) process.exit(0);

  if (envelope.file) writeCopilotInstructions(envelope.file);

  if (envelope.kind === "text") console.log(envelope.payload);
  else process.stdout.write(envelope.payload);
  logContextInjected(input, reminder);
  logDebug("LoadContext", `Reminder injected: ${reminder.length} chars`);
} catch (err) {
  logError("LoadContext:reminder", err);
}
