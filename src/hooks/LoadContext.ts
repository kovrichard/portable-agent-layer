/**
 * Hook: SessionStart — Injects dynamic context + regenerates AGENTS.md if stale.
 *
 * Static context (TELOS, setup prompt) is loaded natively from AGENTS.md / CLAUDE.md.
 * This hook injects dynamic context only: wisdom principles, relationship notes,
 * learning digest, signal trends, failure patterns, active work state.
 */

import { buildClaudeMd, regenerateIfNeeded } from "./lib/claude-md";
import { buildSystemReminder } from "./lib/context";
import { logDebug, logError } from "./lib/log";

// --- Skip heavy context for subagents ---
const isSubagent =
  process.env.CLAUDE_PROJECT_DIR?.includes("/.claude/Agents/") ||
  process.env.CLAUDE_AGENT_TYPE !== undefined;

if (isSubagent) {
  logDebug("LoadContext", "Subagent session — skipping context loading");
  process.exit(0);
}

// --- Regenerate CLAUDE.md if telos or setup changed ---
try {
  const rebuilt = regenerateIfNeeded();
  if (rebuilt) logDebug("LoadContext", "AGENTS.md regenerated");
} catch (err) {
  logError("LoadContext:regenerate", err);
}

// --- Context to stdout ---
try {
  const reminder = buildSystemReminder();
  if (!reminder) process.exit(0);

  if (process.env.CURSOR_VERSION) {
    // Cursor: no native user-level rules — inject AGENTS.md + dynamic context
    const agentsMd = buildClaudeMd();
    const context = [agentsMd, reminder].filter(Boolean).join("\n\n");
    process.stdout.write(JSON.stringify({ additional_context: context }));
  } else {
    // Claude Code: raw text
    console.log(reminder);
  }
  logDebug("LoadContext", `Reminder injected: ${reminder.length} chars`);
} catch (err) {
  logError("LoadContext:reminder", err);
}
