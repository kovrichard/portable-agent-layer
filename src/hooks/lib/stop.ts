/**
 * Shared stop handlers - runs all stop event logic.
 * Used by StopOrchestrator.ts (Claude Code) and opencode plugin.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { autoGraduate } from "../handlers/auto-graduate";
import { autoBackup } from "../handlers/backup";
import { writeContextDigests } from "../handlers/context-digests";
import { notifyDesktop } from "../handlers/desktop-notify";
import { captureFailure } from "../handlers/failure";
import { persistLastExchange } from "../handlers/persist-last-exchange";
import { projectTouch } from "../handlers/project-touch";
import { checkReflectTrigger } from "../handlers/reflect-trigger";
import { checkSelfModelTrigger } from "../handlers/self-model-trigger";
import { captureSessionIntelligence } from "../handlers/session-intelligence";
import { runSynthesis } from "../handlers/synthesis";
import { resetTab } from "../handlers/tab";
import { updateCounts } from "../handlers/update-counts";
import { captureWorkSession } from "../handlers/work-session";
import { inference } from "./inference";
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

  // Always persist last exchange — drives CompactRecover + "Pick Up Where You Left Off"
  if (options.sessionId) persistLastExchange(messages, options.sessionId);

  // Run all handlers concurrently. Auto-graduate is idempotent (24h TTL +
  // state-dedup + content-dedup) so it's safe to fire on every Stop.
  // project-touch only fires when cwd resolves to an active registered project.
  const results = await Promise.allSettled([
    captureWorkSession(transcript, options.sessionId),
    resetTab(),
    captureSessionIntelligence(transcript, options.sessionId),
    checkPendingFailure(transcript),
    updateCounts(),
    autoBackup(),
    checkReflectTrigger(),
    checkSelfModelTrigger(),
    runSynthesis(),
    autoGraduate(),
    projectTouch(options.lastAssistantMessage),
    notifyDesktop(options.sessionId),
    Promise.resolve(writeContextDigests()),
  ]);

  const handlerNames = [
    "work-session",
    "tab",
    "session-intelligence",
    "pending-failure",
    "update-counts",
    "backup",
    "reflect-trigger",
    "self-model-trigger",
    "synthesis",
    "auto-graduate",
    "project-touch",
    "desktop-notify",
    "context-digests",
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
      principle?: string;
      responsePreview?: string;
      userPreview?: string;
      cwd?: string;
    };
    unlinkSync(pendingPath);

    // Extract principle from full transcript if not already present
    let { principle, detailedContext } = pending;
    if (!principle) {
      try {
        const msgs = parseMessages(transcript);
        const recent = msgs
          .slice(-10)
          .map((m) => `${m.role.toUpperCase()}: ${extractContent(m).slice(0, 300)}`)
          .join("\n\n");

        const result = await inference({
          system: `Analyze this failed AI interaction. The user rated it ${pending.rating}/10.

Return JSON:
{
  "principle": "<one actionable rule the AI should follow, 10-20 words. Start with a verb: 'Verify...', 'Always...', 'Never...', 'Ask before...'>",
  "detailed_context": "<what went wrong and why, 50-150 words>"
}`,
          user: `User feedback: ${pending.context}\n\nConversation:\n${recent}`,
          maxTokens: 400,
          timeout: 10000,
          jsonSchema: {
            type: "object" as const,
            properties: {
              principle: { type: "string" as const },
              detailed_context: { type: "string" as const },
            },
            required: ["principle", "detailed_context"],
            additionalProperties: false,
          },
        });

        if (result.success && result.output) {
          const parsed = JSON.parse(result.output) as {
            principle?: string;
            detailed_context?: string;
          };
          principle = parsed.principle || undefined;
          if (!detailedContext) detailedContext = parsed.detailed_context || undefined;
        }
      } catch {
        /* graceful fallback — capture without principle */
      }
    }

    await captureFailure(
      pending.rating,
      pending.context,
      transcript,
      detailedContext,
      principle,
      pending.cwd
    );
  } catch {
    // Non-critical
  }
}
