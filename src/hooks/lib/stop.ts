/**
 * Shared stop handlers - runs all stop event logic.
 * Used by StopOrchestrator.ts (Claude Code) and opencode plugin.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { autoBackup } from "../handlers/backup";
import { writeContextDigests } from "../handlers/context-digests";
import { notifyDesktop } from "../handlers/desktop-notify";
import { persistLastExchange } from "../handlers/persist-last-exchange";
import { projectTouch } from "../handlers/project-touch";
import { checkReflectTrigger } from "../handlers/reflect-trigger";
import { checkSelfModelTrigger } from "../handlers/self-model-trigger";
import { runSynthesis } from "../handlers/synthesis";
import { resetTab } from "../handlers/tab";
import { updateCounts } from "../handlers/update-counts";
import { captureWorkSession } from "../handlers/work-session";
import { spawnDetachedInference } from "./detached-inference";
import { logDebug, logError } from "./log";
import { assets, ensureDir, paths } from "./paths";
import { extractContent, extractLastAssistant, parseMessages } from "./transcript";

interface RunStopHandlersOptions {
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

  // Detach inference-bearing handlers — claude --print cold-start can exceed
  // any in-hook budget. These spawn detached bun subprocesses that run the
  // inference and write results to disk; they don't block this hook.
  await detachSessionIntelligence(transcript, options.sessionId);
  await detachFailurePrinciple(transcript);
  // Failure auto-graduation is intentionally NOT wired here: every pattern it
  // ever promoted was a frustration log, not a principle. Wisdom frames are
  // populated by Claude in-conversation (see wisdom.ts header). The handler
  // (handlers/auto-graduate.ts) remains runnable manually via `--run`.

  // Run remaining (non-inference) handlers concurrently.
  // project-touch only fires when cwd resolves to an active registered project.
  const results = await Promise.allSettled([
    captureWorkSession(transcript, options.sessionId),
    resetTab(),
    updateCounts(),
    autoBackup(),
    checkReflectTrigger(),
    checkSelfModelTrigger(),
    runSynthesis(),
    projectTouch(options.lastAssistantMessage),
    notifyDesktop(options.sessionId),
    Promise.resolve(writeContextDigests()),
  ]);

  const handlerNames = [
    "work-session",
    "tab",
    "update-counts",
    "backup",
    "reflect-trigger",
    "self-model-trigger",
    "synthesis",
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

/** Write transcript to a fresh tmp file and return the path. Child unlinks it. */
async function writeTranscriptTmp(transcript: string): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "pal-transcript-"));
  const file = resolve(dir, "transcript.txt");
  await writeFile(file, transcript, "utf-8");
  return file;
}

/** Spawn a detached child to run session-intelligence on a tmp copy of the transcript. */
async function detachSessionIntelligence(
  transcript: string,
  sessionId?: string
): Promise<void> {
  try {
    const transcriptPath = await writeTranscriptTmp(transcript);
    const scriptPath = resolve(assets.hooks(), "handlers", "session-intelligence.ts");
    spawnDetachedInference(
      scriptPath,
      ["--run", sessionId ?? "", transcriptPath],
      "session-intelligence"
    );
  } catch (err) {
    logError("detachSessionIntelligence", err);
  }
}

/**
 * If a pending-failure exists, rename it to a unique path (race-free claim),
 * write the transcript to tmp, spawn the failure-principle handler detached.
 */
async function detachFailurePrinciple(transcript: string): Promise<void> {
  const pendingPath = resolve(paths.state(), "pending-failure.json");
  if (!existsSync(pendingPath)) return;

  // Rename to claim the pending file atomically — prevents two Stop hooks
  // racing on the same low rating (opencode notably fires session.idle AND
  // session.diff concurrently, so runStopHandlers runs twice in parallel).
  const claimedDir = await mkdtemp(resolve(tmpdir(), "pal-pending-"));
  const claimedPath = resolve(claimedDir, "pending.json");
  try {
    await rename(pendingPath, claimedPath);
  } catch (err) {
    // ENOENT means another concurrent Stop hook already claimed it. That's
    // expected and benign — the other process will handle the failure.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
    logError("detachFailurePrinciple", err);
    return;
  }

  try {
    const transcriptPath = await writeTranscriptTmp(transcript);
    const scriptPath = resolve(assets.hooks(), "handlers", "failure-principle.ts");
    spawnDetachedInference(
      scriptPath,
      ["--run", claimedPath, transcriptPath],
      "failure-principle"
    );
  } catch (err) {
    logError("detachFailurePrinciple", err);
  }
}
