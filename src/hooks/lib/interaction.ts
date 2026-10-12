/**
 * Measures every user turn in code and logs the features as turn events; the
 * prompt text goes only to the content store, which never leaves the machine.
 * Per-session tracking lives in state and is discarded with the session.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hearsPromptContext } from "./agent";
import { appendEvent, eventsInMonth, eventsSince, logQuietly } from "./events";
import { asksForLess, followedHint, ignoredHintReminder } from "./interaction-hint-check";
import {
  type Baseline,
  DEFAULT_BASELINE,
  type MoodTurn,
  median,
  moodReminder,
  readMood,
} from "./interaction-mood";
import { shorterApprovedMore } from "./interaction-preferences";
import {
  isCorrection,
  isRepeat,
  REACTION_RULES,
  type Reaction,
  reactionTo,
} from "./interaction-reaction";
import { keepSample, replyEnd } from "./interaction-samples";
import { ensureDir, paths } from "./paths";
import { isSystemText, stripInjectedTags } from "./prompt-text";
import { isEnabled } from "./settings";
import { responseModeOf, turnExtras } from "./turn-extras";
import { backAfterNotificationSec } from "./waiting-on-user";
import { localClock } from "./wall-clock";

interface ReplyShape {
  at: string;
  words: number;
  listItems: number;
  headings: number;
  asked: boolean;
}

export interface TurnEvent extends MoodTurn {
  ts: string;
  session: string;
  channel: string | null;
  hour: number;
  weekday: string;
  reply: Omit<ReplyShape, "at"> | null;
  reaction: Reaction | null;
  reactionRules?: number;
  mood?: string;
  hinted?: boolean;
  complied?: boolean;
  runtime?: string;
}

interface SessionTrack {
  updated: string;
  lastPrompt?: string;
  lastPromptAt?: string;
  reply?: ReplyShape;
  replyEnd?: string;
  recent: TurnEvent[];
  mood?: string;
}

const BREAK_SEC = 20 * 60;
const SKIM_MIN_WORDS = 150;
const SKIM_WORDS_PER_SEC = 10;
const RECENT_KEPT = 12;
const MAX_TRACKED_SESSIONS = 20;
const BASELINE_MIN_SAMPLES = 20;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function replyShape(text: string, at: Date): ReplyShape {
  const lines = text.split("\n");
  return {
    at: at.toISOString(),
    words: wordCount(text),
    listItems: lines.filter((l) => /^\s*(?:[-*]|\d+\.)\s/.test(l)).length,
    headings: lines.filter((l) => /^#{1,6}\s/.test(l)).length,
    asked: text.trim().endsWith("?"),
  };
}

/** The reply belongs to this turn only if it arrived after the previous prompt. */
function answeredReply(track: SessionTrack): ReplyShape | null {
  const reply = track.reply;
  if (!reply || !track.lastPromptAt) return null;
  return reply.at >= track.lastPromptAt ? reply : null;
}

function isSkimmed(reply: ReplyShape | null, gapSec: number | null): boolean {
  if (!reply || gapSec === null || gapSec <= 0 || reply.words < SKIM_MIN_WORDS)
    return false;
  return reply.words / gapSec > SKIM_WORDS_PER_SEC;
}

function replyFeatures({ at: _at, ...features }: ReplyShape): Omit<ReplyShape, "at"> {
  return features;
}

function measureTurn(
  text: string,
  session: string,
  track: SessionTrack,
  now: Date,
  channel: string | null
): TurnEvent {
  const reply = answeredReply(track);
  const gapSec = reply ? (now.getTime() - new Date(reply.at).getTime()) / 1000 : null;
  return {
    ts: now.toISOString(),
    session,
    channel,
    ...localClock(now),
    words: wordCount(text),
    gapSec,
    afterBreak: gapSec !== null && gapSec > BREAK_SEC,
    skimmed: isSkimmed(reply, gapSec),
    interrupted: Boolean(track.lastPromptAt) && !reply,
    repeated: isRepeat(text, track.lastPrompt),
    corrected: isCorrection(text),
    reply: reply ? replyFeatures(reply) : null,
    reaction: reply ? reactionTo(text, track.lastPrompt) : null,
    ...(reply && { reactionRules: REACTION_RULES }),
  };
}

function legacyTurnsDir(): string {
  return ensureDir(resolve(paths.signals(), "interaction"));
}

function logTurn(event: TurnEvent, prompt: string, text: string): void {
  const { ts, session, channel, ...fields } = event;
  logQuietly("turn", () =>
    appendEvent(
      "turn",
      {
        ...fields,
        ...turnExtras(prompt, text),
        backAfterSec: backAfterNotificationSec(session, new Date(ts)),
      },
      { ts, session, channel, content: { prompt: text } }
    )
  );
}

function secondsBetween(from: string | undefined, to: Date): number | null {
  if (!from) return null;
  return Math.round((to.getTime() - new Date(from).getTime()) / 100) / 10;
}

function logReply(
  session: string,
  reply: string,
  shape: ReplyShape,
  track: SessionTrack
) {
  const { at, ...features } = shape;
  logQuietly("reply", () =>
    appendEvent(
      "reply",
      {
        ...features,
        mode: responseModeOf(reply),
        latencySec: secondsBetween(track.lastPromptAt, new Date(at)),
      },
      { ts: at, session, content: { reply } }
    )
  );
}

function readLegacyTurns(file: string): TurnEvent[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TurnEvent];
      } catch {
        return [];
      }
    });
}

function legacyTurnsSince(since: Date): TurnEvent[] {
  const fromMonth = since.toISOString().slice(0, 7);
  const sinceTs = since.toISOString();
  return readdirSync(legacyTurnsDir())
    .filter((f) => f.endsWith(".jsonl") && f.slice(0, 7) >= fromMonth)
    .sort()
    .flatMap((f) => readLegacyTurns(resolve(legacyTurnsDir(), f)))
    .filter((e) => e.ts >= sinceTs);
}

export function turnsSince(since: Date): TurnEvent[] {
  const streamed = eventsSince("turn", since) as unknown as TurnEvent[];
  return [...legacyTurnsSince(since), ...streamed].sort((a, b) =>
    a.ts.localeCompare(b.ts)
  );
}

function turnsInMonth(month: Date): TurnEvent[] {
  const file = `${month.toISOString().slice(0, 7)}.jsonl`;
  const streamed = eventsInMonth("turn", month) as unknown as TurnEvent[];
  return [...readLegacyTurns(resolve(legacyTurnsDir(), file)), ...streamed];
}

/** This month and last, outside the session being judged. */
function historyOutside(session: string, now: Date): TurnEvent[] {
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [...turnsInMonth(lastMonth), ...turnsInMonth(now)].filter(
    (e) => e.session !== session
  );
}

function usualReplyWords(history: TurnEvent[]): number | null {
  const replies = history.flatMap((e) => (e.reply ? [e.reply.words] : []));
  return replies.length >= BASELINE_MIN_SAMPLES ? median(replies) : null;
}

/** The user's own normal, measured on their history. */
function baseline(events: TurnEvent[]): Baseline {
  const gaps = events
    .filter((e) => e.gapSec !== null && !e.afterBreak)
    .map((e) => e.gapSec);
  return {
    words:
      events.length >= BASELINE_MIN_SAMPLES
        ? (median(events.map((e) => e.words)) as number)
        : DEFAULT_BASELINE.words,
    gapSec:
      gaps.length >= BASELINE_MIN_SAMPLES
        ? (median(gaps as number[]) as number)
        : DEFAULT_BASELINE.gapSec,
  };
}

function tracksFile(): string {
  return resolve(paths.state(), "interaction-sessions.json");
}

function readTracks(): Record<string, SessionTrack> {
  try {
    return JSON.parse(readFileSync(tracksFile(), "utf-8"));
  } catch {
    return {};
  }
}

function writeTrack(session: string, track: SessionTrack): void {
  const tracks = { ...readTracks(), [session]: track };
  const kept = Object.entries(tracks)
    .sort(([, a], [, b]) => b.updated.localeCompare(a.updated))
    .slice(0, MAX_TRACKED_SESSIONS);
  writeFileSync(tracksFile(), JSON.stringify(Object.fromEntries(kept)), "utf-8");
}

function trackOf(session: string): SessionTrack {
  return readTracks()[session] ?? { updated: "", recent: [] };
}

/** Called when the agent finishes a reply, so the next turn can be measured against it. */
export function recordReply(
  session: string,
  reply: string,
  now: Date = new Date()
): void {
  if (!session || !reply.trim() || !isEnabled("interactionAwareness")) return;
  const track = trackOf(session);
  const shape = replyShape(reply, now);
  logReply(session, reply, shape, track);
  writeTrack(session, {
    ...track,
    updated: now.toISOString(),
    reply: shape,
    replyEnd: replyEnd(reply),
  });
}

function sampleReaction(event: TurnEvent, text: string, track: SessionTrack): void {
  if (!event.reaction) return;
  keepSample({
    ts: event.ts,
    session: event.session,
    reaction: event.reaction,
    text,
    replyEnd: track.replyEnd ?? "",
  });
}

/** Only while the user still wants less: once the mood is back to usual, length is not the point. */
function reminderForIgnoredHint(
  complied: boolean | null,
  moodKey: string,
  replyWords: number | undefined,
  usualReply: number | null,
  history: TurnEvent[]
): string | null {
  if (complied !== false || !asksForLess(moodKey)) return null;
  if (replyWords === undefined || usualReply === null) return null;
  return ignoredHintReminder(replyWords, usualReply, shorterApprovedMore(history));
}

function joinReminders(...reminders: (string | null)[]): string | null {
  const said = reminders.filter((r): r is string => r !== null);
  return said.length ? said.join("\n") : null;
}

/** Logs the turn and returns a reminder when the session's picture changed, or a hint went unheeded. */
export function observeTurn(
  prompt: string,
  session: string | undefined,
  now: Date = new Date(),
  channel: string | null = process.env.PAL_CHANNEL || null
): string | null {
  if (!session || isSystemText(prompt) || !isEnabled("interactionAwareness")) return null;
  const text = stripInjectedTags(prompt);
  if (!text) return null;
  const track = trackOf(session);
  const history = historyOutside(session, now);
  const usualReply = usualReplyWords(history);
  const event = measureTurn(text, session, track, now, channel);
  const replyWords = event.reply?.words;
  const complied = hearsPromptContext()
    ? followedHint(track.mood, replyWords, usualReply)
    : null;
  const recent = [...track.recent, event].slice(-RECENT_KEPT);
  const mood = readMood(recent, baseline(history));
  const reminder = joinReminders(
    moodReminder(mood, track.mood ?? ""),
    reminderForIgnoredHint(complied, mood.key, replyWords, usualReply, history)
  );
  logTurn(
    {
      ...event,
      mood: mood.key,
      hinted: reminder !== null && hearsPromptContext(),
      ...(complied !== null && { complied }),
    },
    prompt,
    text
  );
  sampleReaction(event, text, track);
  writeTrack(session, {
    ...track,
    updated: now.toISOString(),
    lastPrompt: text,
    lastPromptAt: now.toISOString(),
    recent,
    mood: mood.key,
  });
  return reminder;
}
