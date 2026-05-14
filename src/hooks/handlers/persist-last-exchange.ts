/**
 * Shared handler: persist the last user/assistant exchange on every Stop and PreCompact.
 *
 * Writes two outputs:
 *  1. last-exchange/{sessionId}.json + last-exchange/latest.json
 *     → read by CompactRecover to re-inject after compaction
 *  2. last-handoff.json keyed by cwd
 *     → read by loadHandoff() to surface "Pick Up Where You Left Off"
 *
 * Always overwrites — Stop is the source of truth for both. The LEARN-phase
 * handoff-note.ts tool may also write to last-handoff.json; whichever runs last wins,
 * but raw exchange is sufficient for continuity and costs nothing.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug, logError } from "../lib/log";
import { ensureDir, paths } from "../lib/paths";
import { extractContent, extractLastAssistant, extractLastUser } from "../lib/transcript";
import { detectStatus } from "../lib/work-tracking";

type ParsedMessage = { role: string; content: unknown };

export function persistLastExchange(
  messages: ParsedMessage[],
  sessionId: string,
  cwd: string = process.cwd()
): void {
  try {
    const lastUser = extractContent(extractLastUser(messages));
    const lastAssistant = extractContent(extractLastAssistant(messages));
    if (!lastUser && !lastAssistant) return;

    // 1. Write last-exchange files for CompactRecover
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

    // 2. Write last-handoff.json for "Pick Up Where You Left Off"
    const handoffPath = resolve(paths.state(), "last-handoff.json");
    const existing: Record<string, unknown> = existsSync(handoffPath)
      ? JSON.parse(readFileSync(handoffPath, "utf-8"))
      : {};
    const title = (lastUser.slice(0, 80).replace(/\n/g, " ") || "Session").trim();
    const handoff = [
      lastUser ? `Last user message:\n${lastUser.slice(0, 500)}` : "",
      lastAssistant ? `\nLast assistant response:\n${lastAssistant.slice(0, 500)}` : "",
    ]
      .filter(Boolean)
      .join("");
    existing[cwd] = {
      timestamp: new Date().toISOString(),
      title,
      status: detectStatus(lastAssistant),
      handoff,
      artifacts: [],
    };
    writeFileSync(handoffPath, JSON.stringify(existing, null, 2), "utf-8");

    logDebug(
      "persist-last-exchange",
      `Persisted exchange for session ${sessionId} (user=${lastUser.length}ch, assistant=${lastAssistant.length}ch)`
    );
  } catch (err) {
    logError("persist-last-exchange", err);
  }
}
