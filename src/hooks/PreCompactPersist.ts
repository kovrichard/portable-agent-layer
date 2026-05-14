/**
 * Hook: PreCompact — Persists the last user/assistant exchange before context compaction.
 *
 * Pairs with CompactRecover.ts (SessionStart matcher "compact"), which re-injects this
 * exchange after compaction completes. The compaction summary often glosses over the
 * immediate prior turn; this preserves it verbatim.
 *
 * Storage: ~/.pal/memory/state/last-exchange/{session_id}.json + latest.json.
 * Path lives under PAL_HOME so other agents (OpenCode, Copilot, Cursor) can read the
 * same state if/when they grow equivalent compaction-recovery hooks. PreCompact itself
 * is currently a Claude Code event.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { persistLastExchange } from "./handlers/persist-last-exchange";
import { logDebug, logError } from "./lib/log";
import { paths } from "./lib/paths";
import { readStdinJSON } from "./lib/stdin";
import { readTranscriptFile } from "./lib/transcript";

interface PreCompactInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  trigger?: "manual" | "auto";
  custom_instructions?: string;
}

const main = async () => {
  const input = await readStdinJSON<PreCompactInput>();
  if (!input?.transcript_path) {
    logDebug("PreCompactPersist", "No transcript_path in input — skipping");
    process.exit(0);
  }

  try {
    const messages = readTranscriptFile(input.transcript_path);
    if (messages.length === 0) {
      logDebug("PreCompactPersist", "Transcript empty or unreadable");
      process.exit(0);
    }
    const sessionId = input.session_id ?? "unknown";
    const cwd = input.cwd ?? process.cwd();

    // Stop fires after every response and is authoritative. Skip if it already
    // wrote latest.json for this session — PreCompact is a safety net only.
    const latestPath = resolve(paths.state(), "last-exchange", "latest.json");
    if (existsSync(latestPath)) {
      try {
        const latest = JSON.parse(await readFile(latestPath, "utf-8"));
        if (latest?.sessionId === sessionId) {
          logDebug(
            "PreCompactPersist",
            `Stop already persisted session ${sessionId} — skipping`
          );
          process.exit(0);
        }
      } catch {
        /* unreadable — fall through and write */
      }
    }

    persistLastExchange(messages, sessionId, cwd);
    logDebug(
      "PreCompactPersist",
      `Persisted exchange before compaction for session ${sessionId}`
    );
  } catch (err) {
    logError("PreCompactPersist", err);
  }

  process.exit(0);
};

await main();
