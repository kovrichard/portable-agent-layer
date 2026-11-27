/**
 * The turn log: every message the reaction rater labelled, with the end of the
 * reply it answered. Rule drafts are proven by replaying their trigger over it.
 *
 * One append-only file per month, so parallel sessions and other machines never
 * rewrite each other's lines. A relabelled turn is appended again with the time
 * of its revision, and reading keeps each turn's newest revision.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { storeDir } from "../bronze/bronze";

const turnsDir = () => storeDir("labelled-turns");

const WINDOW_DAYS = 30;
const MESSAGE_MAX = 800;
const REPLY_END_MAX = 600;
const DAY_MS = 86_400_000;
const MONTH_FILE = /^turns-(\d{4})-(\d{2})\.jsonl$/;

export interface TurnInput {
  session: string;
  message: string;
  replyEnd: string;
  reaction: string;
  issue: string;
  /** Set on a correction: whether the second label agreed. */
  confirmed?: boolean;
  /** Set on a confirmed correction: its kind, under the kind set's version. */
  correctionKind?: StoredCorrectionKind;
}

interface StoredCorrectionKind {
  kind: string;
  suggested: string;
  description: string;
  version: number;
}

export interface Turn extends TurnInput {
  ts: string;
  revisedAt?: string;
}

export interface RequestedTurn extends Turn {
  /** The user's request the reply answered, when that message was logged too. */
  prompt: string;
}

function precedingRequest(turns: Turn[], index: number): string {
  const session = turns[index].session;

  for (let i = index - 1; i >= 0; i--) {
    if (turns[i].session === session) return turns[i].message;
  }

  return "";
}

export function withRequests(turns: Turn[]): RequestedTurn[] {
  return turns.map((turn, index) => ({
    ...turn,
    prompt: precedingRequest(turns, index),
  }));
}

function monthFile(date: Date): string {
  return `turns-${date.toISOString().slice(0, 7)}.jsonl`;
}

function monthEnd(file: string): number | null {
  const match = MONTH_FILE.exec(file);

  return match ? Date.UTC(Number(match[1]), Number(match[2]), 1) : null;
}

function monthFiles(): string[] {
  const dir = turnsDir();

  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => MONTH_FILE.test(f))
        .sort()
    : [];
}

function monthsEndingAfter(cutoff: number): string[] {
  return monthFiles().filter((file) => (monthEnd(file) ?? 0) > cutoff);
}

function appendLine(turn: Turn): void {
  appendFileSync(
    resolve(turnsDir(), monthFile(new Date(turn.ts))),
    `${JSON.stringify(turn)}\n`
  );
}

export function appendTurn(turn: TurnInput, now: Date = new Date()): void {
  appendLine({
    ts: now.toISOString(),
    ...turn,
    message: turn.message.slice(0, MESSAGE_MAX),
    replyEnd: turn.replyEnd.slice(-REPLY_END_MAX),
  });
}

function parseLine(line: string): Turn | null {
  try {
    const parsed = JSON.parse(line) as Turn;

    return typeof parsed.ts === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function turnKey(turn: Turn): string {
  return `${turn.session} ${turn.ts}`;
}

function revisedAfter(turn: Turn, now: Date): string {
  const previous = turn.revisedAt ? Date.parse(turn.revisedAt) + 1 : 0;

  return new Date(Math.max(now.getTime(), previous)).toISOString();
}

/** Appends a revision of each turn, stamped after the one it revises; reading keeps the newest. */
export function replaceTurns(
  replacements: Map<string, Turn>,
  now: Date = new Date()
): void {
  for (const turn of replacements.values())
    appendLine({ ...turn, revisedAt: revisedAfter(turn, now) });
}

function newerRevision(kept: Turn, other: Turn): Turn {
  const keptAt = kept.revisedAt ?? "";
  const otherAt = other.revisedAt ?? "";
  if (keptAt !== otherAt) return otherAt > keptAt ? other : kept;

  return JSON.stringify(other) > JSON.stringify(kept) ? other : kept;
}

function newestRevisionByKey(turns: Turn[]): Map<string, Turn> {
  const revisions = new Map<string, Turn>();

  for (const turn of turns.filter((t) => t.revisedAt)) {
    const seen = revisions.get(turnKey(turn));
    revisions.set(turnKey(turn), seen ? newerRevision(seen, turn) : turn);
  }

  return revisions;
}

/** A revised turn once, as its newest revision; the rest as logged; all in time order. */
function readable(turns: Turn[]): Turn[] {
  const revisions = newestRevisionByKey(turns);
  const placed = new Set<string>();
  const kept: Turn[] = [];

  for (const turn of turns) {
    const revision = revisions.get(turnKey(turn));

    if (!revision) kept.push(turn);
    else if (!placed.has(turnKey(turn))) {
      placed.add(turnKey(turn));
      kept.push(revision);
    }
  }

  return kept.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

export function readTurns(days: number = WINDOW_DAYS, now: Date = new Date()): Turn[] {
  const cutoff = now.getTime() - days * DAY_MS;
  const lines = monthsEndingAfter(cutoff).flatMap((file) =>
    readFileSync(resolve(turnsDir(), file), "utf-8").split("\n")
  );

  return readable(
    lines
      .map(parseLine)
      .filter((turn): turn is Turn => turn !== null && Date.parse(turn.ts) >= cutoff)
  );
}
