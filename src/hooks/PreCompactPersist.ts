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

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug, logError } from "./lib/log";
import { ensureDir, paths } from "./lib/paths";
import { readStdinJSON } from "./lib/stdin";
import {
  extractContent,
  extractLastAssistant,
  extractLastUser,
  readTranscriptFile,
} from "./lib/transcript";

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

    const lastUser = extractContent(extractLastUser(messages));
    const lastAssistant = extractContent(extractLastAssistant(messages));

    if (!lastUser && !lastAssistant) {
      logDebug("PreCompactPersist", "No user/assistant text found in transcript");
      process.exit(0);
    }

    const sessionId = input.session_id || "unknown";
    const payload = {
      sessionId,
      timestamp: new Date().toISOString(),
      trigger: input.trigger ?? null,
      customInstructions: input.custom_instructions || null,
      userMessage: lastUser,
      assistantMessage: lastAssistant,
    };

    const stateDir = ensureDir(resolve(paths.state(), "last-exchange"));
    const sessionFile = resolve(stateDir, `${sessionId}.json`);
    const latestFile = resolve(stateDir, "latest.json");
    const json = `${JSON.stringify(payload, null, 2)}\n`;

    writeFileSync(sessionFile, json, "utf-8");
    writeFileSync(latestFile, json, "utf-8");

    logDebug(
      "PreCompactPersist",
      `Saved last exchange (user=${lastUser.length}ch, assistant=${lastAssistant.length}ch) for session ${sessionId}`
    );
  } catch (err) {
    logError("PreCompactPersist", err);
  }

  process.exit(0);
};

main();
