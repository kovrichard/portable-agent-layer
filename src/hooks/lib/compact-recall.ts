/**
 * The last exchange before a compaction, and what is safe to do with it after.
 *
 * A summary can collapse the turn that was in flight when the window filled, so
 * the originals are re-injected verbatim on the next session. Everything here
 * used to sit inside the spawned hook: the budget split, the order the candidate
 * files are tried in, and whether the file just read may be deleted.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

/** Hook output is capped at 10,000 chars; the rest is headroom for the framing. */
const MAX_OUTPUT = 9_000;

/** The user's half. The assistant's reply is the longer of the two in most turns. */
const USER_SHARE = 0.4;

/** Held back for the reminder's headings and framing text. */
const FRAMING_RESERVE = 300;

export interface SavedExchange {
  sessionId: string;
  timestamp: string;
  trigger: string | null;
  customInstructions: string | null;
  userMessage: string;
  assistantMessage: string;
}

export interface RecallBudget {
  user: number;
  assistant: number;
}

export function recallBudget(max: number = MAX_OUTPUT): RecallBudget {
  const user = Math.floor(max * USER_SHARE);
  return { user, assistant: max - user - FRAMING_RESERVE };
}

/** Says how much was dropped, so a truncated message cannot read as a complete one. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n[... truncated ${s.length - max} chars]`;
}

function exchangeDir(): string {
  return resolve(paths.state(), "last-exchange");
}

/**
 * The session's own file first, then the fallback. latest.json is overwritten by
 * every compaction, so it is right only when nothing more specific exists.
 */
export function findSavedExchange(sessionId?: string): string | null {
  const candidates = [
    sessionId ? resolve(exchangeDir(), `${sessionId}.json`) : null,
    resolve(exchangeDir(), "latest.json"),
  ].filter((path): path is string => path !== null);
  return candidates.find((path) => existsSync(path)) ?? null;
}

/**
 * Consume-on-read, but only for the session's own file: latest.json is the
 * safety fallback and deleting it would leave the next compaction with nothing.
 */
export function isConsumable(file: string, sessionId?: string): boolean {
  if (!sessionId) return false;
  return file === resolve(exchangeDir(), `${sessionId}.json`);
}

export function buildRecall(saved: SavedExchange, budget = recallBudget()): string {
  return [
    "<system-reminder>",
    "## Last exchange before compaction",
    "_Restored verbatim from PAL state. The compaction summary may have collapsed this; the originals are below._",
    "",
    "**User:**",
    truncate(saved.userMessage || "(no user message captured)", budget.user),
    "",
    "**Assistant:**",
    truncate(
      saved.assistantMessage || "(no assistant message captured)",
      budget.assistant
    ),
    "</system-reminder>",
  ].join("\n");
}
