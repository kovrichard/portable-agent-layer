/**
 * Hook: SessionStart with matcher "compact" — Re-injects the last exchange after compaction.
 *
 * Reads the state file written by PreCompactPersist.ts and prints a system-reminder to
 * stdout. SessionStart stdout is added as context that Claude can see, per Claude Code
 * hook docs.
 *
 * Storage: ~/.pal/memory/state/last-exchange/{session_id}.json (with latest.json fallback).
 */

import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { isCursor } from "./lib/agent";
import { logDebug, logError } from "./lib/log";
import { paths } from "./lib/paths";
import { readStdinJSON } from "./lib/stdin";

interface SessionStartInput {
  session_id?: string;
  hook_event_name?: string;
  source?: "startup" | "resume" | "clear" | "compact" | string;
}

interface SavedExchange {
  sessionId: string;
  timestamp: string;
  trigger: string | null;
  customInstructions: string | null;
  userMessage: string;
  assistantMessage: string;
}

// Hook output cap is 10,000 chars per Claude Code docs; leave headroom for framing.
const MAX_OUTPUT = 9_000;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n[... truncated ${s.length - max} chars]`;
}

const main = async () => {
  const input = await readStdinJSON<SessionStartInput>();

  // The matcher gates this hook to "compact" sessions, but verify defensively in case
  // the matcher is misconfigured or the hook is invoked manually.
  if (input?.source && input.source !== "compact") {
    logDebug("CompactRecover", `source=${input.source} — not compact, skipping`);
    process.exit(0);
  }

  try {
    const stateDir = resolve(paths.state(), "last-exchange");
    const sessionId = input?.session_id;
    const candidates = [
      sessionId ? resolve(stateDir, `${sessionId}.json`) : null,
      resolve(stateDir, "latest.json"),
    ].filter((p): p is string => p !== null);

    const file = candidates.find((p) => existsSync(p));
    if (!file) {
      logDebug("CompactRecover", "No saved exchange found — silent no-op");
      process.exit(0);
    }

    const saved = JSON.parse(await readFile(file, "utf-8")) as SavedExchange;
    const userBudget = Math.floor(MAX_OUTPUT * 0.4);
    const assistantBudget = MAX_OUTPUT - userBudget - 300; // reserve for framing

    const out = [
      "<system-reminder>",
      "## Last exchange before compaction",
      "_Restored verbatim from PAL state. The compaction summary may have collapsed this; the originals are below._",
      "",
      "**User:**",
      truncate(saved.userMessage || "(no user message captured)", userBudget),
      "",
      "**Assistant:**",
      truncate(
        saved.assistantMessage || "(no assistant message captured)",
        assistantBudget
      ),
      "</system-reminder>",
    ].join("\n");

    if (isCursor()) {
      process.stdout.write(JSON.stringify({ additional_context: out }));
    } else {
      process.stdout.write(out);
    }
    logDebug("CompactRecover", `Re-injected ${out.length} chars from ${file}`);

    // Consume-on-read: drop the session-keyed file after a successful injection so it
    // doesn't sit on disk forever. latest.json is preserved as a safety fallback and
    // gets overwritten on the next compaction.
    const sessionFile = sessionId ? resolve(stateDir, `${sessionId}.json`) : null;
    if (sessionFile && file === sessionFile) {
      try {
        await unlink(sessionFile);
      } catch (err) {
        logError("CompactRecover:cleanup", err);
      }
    }
  } catch (err) {
    logError("CompactRecover", err);
  }

  process.exit(0);
};

main();
