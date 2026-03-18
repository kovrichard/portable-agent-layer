/**
 * Shared stop handlers - runs all stop event logic.
 * Used by StopOrchestrator.ts (Claude Code) and opencode plugin.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { captureFailure } from "../handlers/failure";
import { captureLearning } from "../handlers/learning";
import { captureRelationship } from "../handlers/relationship";
import { resetTab } from "../handlers/tab";
import { updateCounts } from "../handlers/update-counts";
import { captureWork } from "../handlers/work";
import { captureWorkLearning } from "../handlers/work-learning";
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

  // Cache last assistant response
  cacheLastResponse(messages, options.lastAssistantMessage);

  // Run all handlers concurrently (manual wisdom extraction only - no automatic extraction)
  const results = await Promise.allSettled([
    captureLearning(transcript),
    captureWork(transcript),
    resetTab(),
    captureRelationship(transcript, options.sessionId),
    captureWorkLearning(transcript),
    checkPendingFailure(transcript),
    updateCounts(),
  ]);

  const handlerNames = [
    "learning",
    "work",
    "tab",
    "relationship",
    "work-learning",
    "pending-failure",
    "update-counts",
  ];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      logError(`runStopHandlers:${handlerNames[i]}`, r.reason);
    }
  }
}

/** Cache the last assistant response for RatingCapture */
function cacheLastResponse(
  msgs: ReturnType<typeof parseMessages>,
  lastAssistantMessage?: string
): void {
  try {
    let lastResponse = lastAssistantMessage;
    if (!lastResponse) {
      const lastAssistant = extractLastAssistant(msgs);
      lastResponse = extractContent(lastAssistant);
    }
    if (!lastResponse) return;

    const cachePath = resolve(ensureDir(paths.state()), "last-response.txt");
    writeFileSync(cachePath, lastResponse.slice(0, 2000), "utf-8");
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
    };
    unlinkSync(pendingPath);
    await captureFailure(pending.rating, pending.context, transcript);
  } catch {
    // Non-critical
  }
}
