/**
 * Measures every user turn in code and logs the features, never the text.
 * Per-session tracking lives in state and is discarded with the session.
 */

import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { currentAttribution } from "./actor";
import { hearsPromptContext } from "./agent";
import {
  type Baseline,
  DEFAULT_BASELINE,
  type MoodTurn,
  median,
  moodReminder,
  readMood,
} from "./interaction-mood";
import {
  isCorrection,
  isRepeat,
  type Reaction,
  reactionTo,
} from "./interaction-reaction";
import { keepSample, replyEnd } from "./interaction-samples";
import { ensureDir, paths } from "./paths";
import { isSystemText, stripInjectedTags } from "./prompt-text";
import { isEnabled } from "./settings";
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
  mood?: string;
  hinted?: boolean;
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
  };
}

function eventsDir(): string {
  return ensureDir(resolve(paths.signals(), "interaction"));
}

function monthFile(date: Date): string {
  return resolve(eventsDir(), `${date.toISOString().slice(0, 7)}.jsonl`);
}

function appendEvent(event: TurnEvent): void {
  const line = { ...currentAttribution(), type: "turn", ...event };
  appendFileSync(monthFile(new Date(event.ts)), `${JSON.stringify(line)}\n`);
}

function readEvents(file: string): TurnEvent[] {
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

export function turnsSince(since: Date): TurnEvent[] {
  const fromMonth = since.toISOString().slice(0, 7);
  const sinceTs = since.toISOString();
  return readdirSync(eventsDir())
    .filter((f) => f.endsWith(".jsonl") && f.slice(0, 7) >= fromMonth)
    .sort()
    .flatMap((f) => readEvents(resolve(eventsDir(), f)))
    .filter((e) => e.ts >= sinceTs);
}

/** The user's own normal, from this month and last, outside the session being judged. */
function baseline(session: string, now: Date = new Date()): Baseline {
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const events = [
    ...readEvents(monthFile(lastMonth)),
    ...readEvents(monthFile(now)),
  ].filter((e) => e.session !== session);
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
  writeTrack(session, {
    ...track,
    updated: now.toISOString(),
    reply: replyShape(reply, now),
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

/** Logs the turn and returns a reminder when the session's picture changed. */
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
  const event = measureTurn(text, session, track, now, channel);
  const recent = [...track.recent, event].slice(-RECENT_KEPT);
  const mood = readMood(recent, baseline(session, now));
  const reminder = moodReminder(mood, track.mood ?? "");
  appendEvent({
    ...event,
    mood: mood.key,
    hinted: reminder !== null && hearsPromptContext(),
  });
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
