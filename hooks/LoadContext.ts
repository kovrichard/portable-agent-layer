/**
 * Hook: SessionStart — Loads TELOS context + active work state.
 * Outputs a <system-reminder> so the AI has your identity/goals in context.
 * Also prints a visible startup greeting with stats.
 *
 * If first-run setup is incomplete, injects setup wizard instructions.
 *
 * This is the most important hook — it's what makes the AI "know you".
 */

import { buildGreeting, buildSystemReminder } from "./lib/context";

// --- Visible greeting to stderr ---
process.stderr.write(buildGreeting().join("\n") + "\n");

// --- System-reminder to stdout ---
console.log(buildSystemReminder());
