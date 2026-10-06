/**
 * The turn log: every message the reaction rater labelled, with the end of the
 * reply it answered. Rule drafts are proven by replaying their trigger over it.
 *
 * One append-only file per month, so parallel sessions never rewrite each
 * other's lines; a month is deleted whole once it ends before the window.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

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
}

export interface Turn extends TurnInput {
  ts: string;
}

function monthFile(date: Date): string {
  return `turns-${date.toISOString().slice(0, 7)}.jsonl`;
}

function monthEnd(file: string): number | null {
  const match = MONTH_FILE.exec(file);
  return match ? Date.UTC(Number(match[1]), Number(match[2]), 1) : null;
}

function monthFiles(): string[] {
  const dir = paths.adaptation();
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => MONTH_FILE.test(f))
        .sort()
    : [];
}

function pruneMonthsBefore(cutoff: number): void {
  for (const file of monthFiles()) {
    const end = monthEnd(file);
    if (end !== null && end <= cutoff)
      rmSync(resolve(paths.adaptation(), file), { force: true });
  }
}

export function appendTurn(turn: TurnInput, now: Date = new Date()): void {
  const record: Turn = {
    ts: now.toISOString(),
    ...turn,
    message: turn.message.slice(0, MESSAGE_MAX),
    replyEnd: turn.replyEnd.slice(-REPLY_END_MAX),
  };
  appendFileSync(
    resolve(paths.adaptation(), monthFile(now)),
    `${JSON.stringify(record)}\n`
  );
  pruneMonthsBefore(now.getTime() - WINDOW_DAYS * DAY_MS);
}

function parseLine(line: string): Turn | null {
  try {
    const parsed = JSON.parse(line) as Turn;
    return typeof parsed.ts === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function readTurns(days: number = WINDOW_DAYS, now: Date = new Date()): Turn[] {
  const cutoff = now.getTime() - days * DAY_MS;
  return monthFiles()
    .flatMap((file) =>
      readFileSync(resolve(paths.adaptation(), file), "utf-8").split("\n")
    )
    .map(parseLine)
    .filter((turn): turn is Turn => turn !== null && Date.parse(turn.ts) >= cutoff);
}
