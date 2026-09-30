/**
 * Shared handler: persist the last user/assistant exchange on every Stop and PreCompact.
 *
 * Writes two outputs:
 *  1. last-exchange/{sessionId}.json + last-exchange/latest.json
 *     → read by CompactRecover to re-inject after compaction
 *  2. last-handoff.json keyed by the session's start folder
 *     → read by loadHandoffContext() to surface "Pick Up Where You Left Off"
 *
 * last-exchange is always overwritten — Stop is its source of truth. In
 * last-handoff only the exchange fields are: a deliberate LEARN-phase note
 * (source:"deliberate") and the summary session intelligence wrote for this
 * session both stay beside it (ISC-39).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { trimAtWord } from "../lib/handoff-context";
import { logDebug, logError } from "../lib/log";
import { ensureDir, paths } from "../lib/paths";
import { sessionDir } from "../lib/session-dir";
import { extractContent, extractLastAssistant, extractLastUser } from "../lib/transcript";

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

interface AutoHandoff {
  title: string;
  status: string;
  handoff: string;
  waitingOn?: string;
  sessionId?: string;
}

interface LastExchange {
  sessionId: string;
  lastUser: string;
  lastAssistant: string;
}

type StoredHandoff = Partial<AutoHandoff & LastExchange> & {
  timestamp?: string;
  source?: string;
  artifacts?: string[];
};

const LAST_USER_MAX_CHARS = 200;
const LAST_ASSISTANT_MAX_CHARS = 300;

function handoffPath(): string {
  return resolve(ensureDir(paths.state()), "last-handoff.json");
}

function readHandoffs(): Record<string, StoredHandoff> {
  try {
    const p = handoffPath();
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : {};
  } catch {
    return {};
  }
}

function isWithinReadWindow(entry: StoredHandoff): boolean {
  if (!entry.timestamp) return false;
  return Date.now() - new Date(entry.timestamp).getTime() <= HANDOFF_STALE_MS;
}

function writeHandoffs(handoffs: Record<string, StoredHandoff>): void {
  const readable = Object.entries(handoffs).filter(([, entry]) =>
    isWithinReadWindow(entry)
  );
  writeFileSync(
    handoffPath(),
    JSON.stringify(Object.fromEntries(readable), null, 2),
    "utf-8"
  );
}

export function structuredHandoff(parts: {
  done: string;
  next: string;
  waitingOn: string;
}): string {
  return [
    parts.done && `Done: ${parts.done}`,
    parts.next && `Next: ${parts.next}`,
    parts.waitingOn && `Waiting on you: ${parts.waitingOn}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function sameSession(entry: StoredHandoff | undefined, sessionId?: string): boolean {
  return sessionId !== undefined && entry?.sessionId === sessionId;
}

/** Record this folder's summary unless a fresh deliberate note already owns it (ISC-39). */
export function writeAutoHandoff(cwd: string, entry: AutoHandoff): void {
  const handoffs = readHandoffs();
  const existing = handoffs[cwd];
  if (isProtectedHandoff(existing)) return;
  const exchange = sameSession(existing, entry.sessionId)
    ? { lastUser: existing?.lastUser, lastAssistant: existing?.lastAssistant }
    : {};
  handoffs[cwd] = {
    timestamp: new Date().toISOString(),
    ...entry,
    ...exchange,
    artifacts: [],
    source: "auto",
  };
  writeHandoffs(handoffs);
}

function closingParagraph(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 15);
  return paragraphs.at(-1) ?? text;
}

/**
 * The raw exchange is written on every stop; the summary only every few
 * messages. So within one session the exchange is refreshed beside the
 * summary rather than over it, and a new session starts a clean entry.
 */
function recordLastExchange(cwd: string, exchange: LastExchange): void {
  const handoffs = readHandoffs();
  const existing = handoffs[cwd];
  const trimmed = {
    sessionId: exchange.sessionId,
    lastUser: trimAtWord(exchange.lastUser, LAST_USER_MAX_CHARS),
    lastAssistant: trimAtWord(
      closingParagraph(exchange.lastAssistant),
      LAST_ASSISTANT_MAX_CHARS
    ),
  };
  if (isProtectedHandoff(existing)) {
    handoffs[cwd] = { ...existing, ...trimmed };
  } else if (sameSession(existing, exchange.sessionId)) {
    handoffs[cwd] = { ...existing, ...trimmed, timestamp: new Date().toISOString() };
  } else {
    handoffs[cwd] = {
      timestamp: new Date().toISOString(),
      title: trimAtWord(exchange.lastUser, 80) || "Session",
      status: "in-progress",
      handoff: "",
      artifacts: [],
      source: "auto",
      ...trimmed,
    };
  }
  writeHandoffs(handoffs);
}

export function persistLastExchange(
  messages: ParsedMessage[],
  sessionId: string,
  cwd: string = sessionDir()
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

    recordLastExchange(cwd, { sessionId, lastUser, lastAssistant });

    logDebug(
      "persist-last-exchange",
      `Persisted exchange for session ${sessionId} (user=${lastUser.length}ch, assistant=${lastAssistant.length}ch)`
    );
  } catch (err) {
    logError("persist-last-exchange", err);
  }
}
