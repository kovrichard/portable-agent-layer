/**
 * Shared handler: persist the last user/assistant exchange on every Stop and PreCompact.
 *
 * Writes two outputs:
 *  1. last-exchange/{sessionId}.json + last-exchange/latest.json
 *     → read by CompactRecover to re-inject after compaction
 *  2. last-handoff.json keyed by cwd
 *     → read by loadHandoff() to surface "Pick Up Where You Left Off"
 *
 * last-exchange is always overwritten — Stop is its source of truth. last-handoff
 * is NOT: a deliberate LEARN-phase note (written by handoff-note.ts with
 * source:"deliberate") outranks this raw auto-snapshot, so we leave it intact
 * while it is still fresh and in-progress. Otherwise the auto-snapshot would
 * clobber the curated handoff the moment the session stopped (ISC-39).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logDebug, logError } from "../lib/log";
import { ensureDir, paths } from "../lib/paths";
import { extractContent, extractLastAssistant, extractLastUser } from "../lib/transcript";
import { detectStatus } from "../lib/work-tracking";

type ParsedMessage = { role: string; content: unknown };

/** Matches loadHandoff()'s staleness window in hooks/lib/context.ts. */
const HANDOFF_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** A fresh, in-progress deliberate note must not be overwritten by the auto-snapshot. */
function isProtectedHandoff(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as { source?: string; status?: string; timestamp?: string };
  if (e.source !== "deliberate" || e.status !== "in-progress" || !e.timestamp)
    return false;
  return Date.now() - new Date(e.timestamp).getTime() <= HANDOFF_STALE_MS;
}

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

    // 2. Write last-handoff.json for "Pick Up Where You Left Off" — unless a
    //    fresh deliberate note already owns this cwd (ISC-39).
    const handoffPath = resolve(paths.state(), "last-handoff.json");
    const existing: Record<string, unknown> = existsSync(handoffPath)
      ? JSON.parse(readFileSync(handoffPath, "utf-8"))
      : {};
    if (!isProtectedHandoff(existing[cwd])) {
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
        source: "auto",
      };
      writeFileSync(handoffPath, JSON.stringify(existing, null, 2), "utf-8");
    }

    logDebug(
      "persist-last-exchange",
      `Persisted exchange for session ${sessionId} (user=${lastUser.length}ch, assistant=${lastAssistant.length}ch)`
    );
  } catch (err) {
    logError("persist-last-exchange", err);
  }
}
