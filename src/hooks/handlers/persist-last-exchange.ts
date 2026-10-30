/**
 * Shared handler: persist the last user/assistant exchange on every Stop and PreCompact
 * to last-exchange/{sessionId}.json + last-exchange/latest.json, which
 * CompactRecover re-injects after compaction.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug, logError } from "../lib/log";
import { ensureDir, paths } from "../lib/paths";
import { extractContent, extractLastAssistant, extractLastUser } from "../lib/transcript";

type ParsedMessage = { role: string; content: unknown };

export function persistLastExchange(messages: ParsedMessage[], sessionId: string): void {
  try {
    const lastUser = extractContent(extractLastUser(messages));
    const lastAssistant = extractContent(extractLastAssistant(messages));
    if (!lastUser && !lastAssistant) return;

    const stateDir = ensureDir(resolve(paths.state(), "last-exchange"));
    const payload = {
      sessionId,
      timestamp: new Date().toISOString(),
      trigger: null,
      customInstructions: null,
      userMessage: lastUser,
      assistantMessage: lastAssistant,
    };
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    writeFileSync(resolve(stateDir, `${sessionId}.json`), json, "utf-8");
    writeFileSync(resolve(stateDir, "latest.json"), json, "utf-8");

    logDebug(
      "persist-last-exchange",
      `Persisted exchange for session ${sessionId} (user=${lastUser.length}ch, assistant=${lastAssistant.length}ch)`
    );
  } catch (err) {
    logError("persist-last-exchange", err);
  }
}
