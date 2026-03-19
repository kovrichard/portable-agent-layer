/**
 * Shared stop handlers - runs all stop event logic.
 * Used by StopOrchestrator.ts (Claude Code) and opencode plugin.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { autoBackup } from "../handlers/backup";
import { captureFailure } from "../handlers/failure";
import { captureRelationship } from "../handlers/relationship";
import { resetTab } from "../handlers/tab";
import { updateCounts } from "../handlers/update-counts";
import { captureWorkLearning } from "../handlers/work-learning";
import { captureWorkSession } from "../handlers/work-session";
import { logDebug, logError } from "./log";
import { ensureDir, paths } from "./paths";
import { extractContent, extractLastAssistant, parseMessages } from "./transcript";

export interface RunStopHandlersOptions {
  lastAssistantMessage?: string;
  sessionId?: string;
}

/** Run all stop handlers with a transcript string */
export async function runStopHandlers(
  transcript: string,
  options: RunStopHandlersOptions = {}
): Promise<void> {
  const messages = parseMessages(transcript);
  if (messages.length < 2) return;

  logDebug("runStopHandlers", `Running handlers (${messages.length} messages)`);

  // Cache last assistant response (session-scoped)
  cacheLastResponse(messages, options.lastAssistantMessage, options.sessionId);

  // Run all handlers concurrently (manual wisdom extraction only - no automatic extraction)
  const results = await Promise.allSettled([
    captureWorkSession(transcript, options.sessionId),
    resetTab(),
    captureRelationship(transcript, options.sessionId),
    captureWorkLearning(transcript, options.sessionId),
    checkPendingFailure(transcript),
    updateCounts(),
    autoBackup(),
  ]);

  const handlerNames = [
    "work-session",
    "tab",
    "relationship",
    "work-learning",
    "pending-failure",
    "update-counts",
    "backup",
  ];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      logError(`runStopHandlers:${handlerNames[i]}`, r.reason);
    }
  }
}

/**
 * Cache the last assistant response per session for RatingCapture.
 * Stores a map of session_id → { response, ts } in last-responses.json.
 * Keeps at most MAX_CACHED_SESSIONS entries (evicts oldest by ts).
 */
const MAX_CACHED_SESSIONS = 20;

interface CachedResponse {
  response: string;
  ts: string;
}

function cacheLastResponse(
  msgs: ReturnType<typeof parseMessages>,
  lastAssistantMessage?: string,
  sessionId?: string
): void {
  if (!sessionId) return; // Can't cache without a session key

  try {
    let lastResponse = lastAssistantMessage;
    if (!lastResponse) {
      const lastAssistant = extractLastAssistant(msgs);
      lastResponse = extractContent(lastAssistant);
    }
    if (!lastResponse) return;

    const cachePath = resolve(ensureDir(paths.state()), "last-responses.json");

    // Read existing cache
    let cache: Record<string, CachedResponse> = {};
    if (existsSync(cachePath)) {
      try {
        cache = JSON.parse(readFileSync(cachePath, "utf-8"));
      } catch {
        cache = {};
      }
    }

    // Upsert this session
    cache[sessionId] = {
      response: lastResponse.slice(0, 2000),
      ts: new Date().toISOString(),
    };

    // Evict oldest if over limit
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHED_SESSIONS) {
      const sorted = keys.sort((a, b) =>
        (cache[a].ts ?? "").localeCompare(cache[b].ts ?? "")
      );
      for (const key of sorted.slice(0, keys.length - MAX_CACHED_SESSIONS)) {
        delete cache[key];
      }
    }

    writeFileSync(cachePath, JSON.stringify(cache), "utf-8");
    logDebug("runStopHandlers", "Cached last response for RatingCapture");
  } catch (err) {
    logError("runStopHandlers:cacheLastResponse", err);
  }
}

async function checkPendingFailure(transcript: string): Promise<void> {
  const pendingPath = resolve(paths.state(), "pending-failure.json");
  if (!existsSync(pendingPath)) return;

  try {
    const pending = JSON.parse(readFileSync(pendingPath, "utf-8")) as {
      rating: number;
      context: string;
      detailedContext?: string;
    };
    unlinkSync(pendingPath);
    await captureFailure(
      pending.rating,
      pending.context,
      transcript,
      pending.detailedContext
    );
  } catch {
    // Non-critical
  }
}
