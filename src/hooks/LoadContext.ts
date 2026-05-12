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

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildClaudeMd, regenerateIfNeeded } from "./lib/claude-md";
import { type AgentTarget, buildSystemReminder } from "./lib/context";
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
  // Determine agent target — controls which sections are skipped (loaded natively instead).
  let agent: AgentTarget = "claude";
  if (process.env.PAL_AGENT === "copilot") agent = "copilot";
  else if (process.env.CURSOR_VERSION) agent = "cursor";
  const reminder = buildSystemReminder({ agent });
  if (!reminder) process.exit(0);

  if (process.env.PAL_AGENT === "copilot") {
    // Copilot: semi-static in ~/.copilot/instructions/pal-*.instructions.md (written at stop).
    // Write AGENTS.md + dynamic context to pal-session.instructions.md on each session start.
    const instructionsDir = resolve(platform.copilotDir(), "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    const agentsMd = buildClaudeMd();
    const context = [agentsMd, reminder].filter(Boolean).join("\n\n");
    if (context) {
      writeFileSync(
        resolve(instructionsDir, "pal-session.instructions.md"),
        `---\napplyTo: "**"\n---\n\n${context}`,
        "utf-8"
      );
    }
    logDebug(
      "LoadContext",
      `Copilot session instructions written: ${context.length} chars`
    );
  } else if (process.env.CURSOR_VERSION) {
    // Cursor: semi-static in ~/.cursor/rules/pal-context.mdc; inject AGENTS.md + dynamic here
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
