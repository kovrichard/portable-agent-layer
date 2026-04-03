/**
 * Hook: SessionStart — Injects dynamic context + regenerates AGENTS.md if stale.
 *
 * Static context (TELOS, setup prompt) is loaded natively from AGENTS.md / CLAUDE.md.
 * This hook injects dynamic context only: wisdom principles, relationship notes,
 * learning digest, signal trends, failure patterns, active work state.
 *
 * Copilot: sessionStart output is ignored by the runtime. Instead, we write the merged
 * context directly to ~/.copilot/copilot-instructions.md so it is picked up on load.
 */

import { existsSync, lstatSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildClaudeMd, regenerateIfNeeded } from "./lib/claude-md";
import { buildSystemReminder } from "./lib/context";
import { logDebug, logError } from "./lib/log";
import { platform } from "./lib/paths";

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

// --- Context to stdout (or file for Copilot) ---
try {
  const reminder = buildSystemReminder();
  if (!reminder) process.exit(0);

  if (process.env.PAL_AGENT === "copilot") {
    // Copilot: sessionStart output is ignored — write merged context to copilot-instructions.md
    const instructionsPath = resolve(platform.copilotDir(), "copilot-instructions.md");
    const agentsMd = buildClaudeMd();
    const context = [agentsMd, reminder].filter(Boolean).join("\n\n");
    if (existsSync(instructionsPath) && lstatSync(instructionsPath).isSymbolicLink()) {
      unlinkSync(instructionsPath);
    }
    writeFileSync(instructionsPath, context, "utf-8");
    logDebug("LoadContext", `Copilot instructions written: ${context.length} chars`);
  } else if (process.env.CURSOR_VERSION) {
    // Cursor: no native user-level rules — inject AGENTS.md + dynamic context
    const agentsMd = buildClaudeMd();
    const context = [agentsMd, reminder].filter(Boolean).join("\n\n");
    process.stdout.write(JSON.stringify({ additional_context: context }));
    logDebug("LoadContext", `Reminder injected: ${reminder.length} chars`);
  } else {
    // Claude Code: raw text
    console.log(reminder);
    logDebug("LoadContext", `Reminder injected: ${reminder.length} chars`);
  }
} catch (err) {
  logError("LoadContext:reminder", err);
}
