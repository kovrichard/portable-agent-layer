/**
 * Hook: SessionStart — Injects dynamic context + regenerates AGENTS.md if stale.
 *
 * Static context (TELOS, setup prompt) is loaded natively from AGENTS.md / CLAUDE.md.
 * This hook injects dynamic context only: wisdom principles, relationship notes,
 * learning digest, signal trends, failure patterns, active work state.
 */

import { buildGreeting, buildSystemReminder } from "./lib/context";
import { regenerateIfNeeded } from "./lib/claude-md";

// --- Regenerate CLAUDE.md if telos or setup changed ---
regenerateIfNeeded();

// --- Visible greeting to stderr ---
process.stderr.write(buildGreeting().join("\n") + "\n");

// --- Dynamic system-reminder to stdout (empty = nothing injected) ---
const reminder = buildSystemReminder();
if (reminder) console.log(reminder);
