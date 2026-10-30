/**
 * Hook: SessionStart — Injects dynamic context + regenerates AGENTS.md if stale.
 *
 * Static context (TELOS, setup prompt) is loaded natively from AGENTS.md /
 * CLAUDE.md. This hook injects dynamic context only: the progress tree,
 * opinions, work state.
 *
 * Which agent gets what, in which envelope, is in lib/session-context.ts.
 */

import { getActiveAgent } from "./lib/agent";
import { autoUpdateOnStart } from "./lib/auto-update";
import { buildClaudeMd, regenerateIfNeeded } from "./lib/claude-md";
import { type AgentTarget, buildSystemReminder } from "./lib/context";
import { logContextInjected } from "./lib/context-overhead";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { hookSessionId } from "./lib/hook-turn";
import { logContextSnapshot, logDebug, logError } from "./lib/log";
import {
  contextEnvelope,
  contextForSource,
  isSubagentSession,
  needsAgentsMd,
  writeCopilotInstructions,
} from "./lib/session-context";
import { logSessionStart, type SessionStartPayload } from "./lib/session-events";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

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

try {
  const active = getActiveAgent();
  const input = await readStdinJSON<SessionStartPayload>();
  logSessionStart(input);
  const wanted = contextForSource(active, input?.source);
  if (wanted === "none") {
    logDebug("LoadContext", `source=${input?.source}, context already present`);
    process.exit(0);
  }

  // The reminder is built for one of four targets; every other agent reads the
  // same shape Claude Code does.
  const target: AgentTarget =
    active === "copilot" || active === "cursor" || active === "codex" ? active : "claude";
  const reminder = buildSystemReminder({
    agent: target,
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
