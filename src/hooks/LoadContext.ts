/**
 * Hook: SessionStart — Injects dynamic context + regenerates AGENTS.md if stale.
 *
 * Static context (TELOS, setup prompt) is loaded natively from AGENTS.md /
 * CLAUDE.md. This hook injects dynamic context only: wisdom principles,
 * relationship notes, learning digest, signal trends, failure patterns, work state.
 *
 * Which agent gets what, in which envelope, is in lib/session-context.ts.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getActiveAgent } from "./lib/agent";
import { autoUpdateOnStart } from "./lib/auto-update";
import { buildClaudeMd, regenerateIfNeeded } from "./lib/claude-md";
import { type AgentTarget, buildSystemReminder } from "./lib/context";
import { duplicatesCursorHooks } from "./lib/cursor-shadow";
import { logContextSnapshot, logDebug, logError } from "./lib/log";
import { platform } from "./lib/paths";
import {
  contextEnvelope,
  contextForSource,
  copilotInstructions,
  isSubagentSession,
  needsAgentsMd,
} from "./lib/session-context";
import { isPalSpawnedInference } from "./lib/spawn-guard";
import { readStdinJSON } from "./lib/stdin";

// Recursion guard — when this process is a PAL-spawned inference subprocess,
// skip all context loading so we don't trigger another inference call.
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
  const input = await readStdinJSON<{ source?: string }>();
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
    withoutHandoff: wanted === "without-handoff",
  });
  if (!reminder) process.exit(0);
  logContextSnapshot(reminder);

  const envelope = contextEnvelope(
    active,
    reminder,
    needsAgentsMd(active) ? buildClaudeMd() : ""
  );
  if (!envelope) process.exit(0);

  if (envelope.file) {
    const dir = resolve(platform.copilotDir(), "instructions");
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "pal-session.instructions.md");
    writeFileSync(path, copilotInstructions(envelope.file), "utf-8");
  }

  if (envelope.kind === "text") console.log(envelope.payload);
  else process.stdout.write(envelope.payload);
  logDebug("LoadContext", `Reminder injected: ${reminder.length} chars`);
} catch (err) {
  logError("LoadContext:reminder", err);
}
