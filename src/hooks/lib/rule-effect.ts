/**
 * What an approved rule did: how often it fired, and whether the user still
 * corrected the reply it steered. A turn is stamped with when its message was
 * sent, so the first turn in a session after a fire judges the steered reply.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RuleTrigger } from "./adaptation-rules";
import type { Turn } from "./adaptation-turns";
import { paths } from "./paths";

const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export interface RuleEvent {
  ts: string;
  rule: string;
  side: RuleTrigger["side"];
  session: string;
  sentBack?: boolean;
}

export interface RuleEffect {
  fired: number;
  sentBack: number;
  /** Fires followed by a labelled turn in the same session. */
  judged: number;
  correctedAfter: number;
}

export function ruleEventsPath(): string {
  return resolve(paths.adaptation(), "rule-events.jsonl");
}

function parseLine(line: string): RuleEvent | null {
  try {
    const parsed = JSON.parse(line) as RuleEvent;
    return typeof parsed.ts === "string" && typeof parsed.rule === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function readRuleEvents(days = WINDOW_DAYS, now = new Date()): RuleEvent[] {
  const path = ruleEventsPath();
  if (!existsSync(path)) return [];
  const cutoff = now.getTime() - days * DAY_MS;
  return readFileSync(path, "utf-8")
    .split("\n")
    .map(parseLine)
    .filter((e): e is RuleEvent => e !== null && Date.parse(e.ts) >= cutoff);
}

function turnAfter(event: RuleEvent, turns: Turn[]): Turn | undefined {
  return turns.find((t) => t.session === event.session && t.ts > event.ts);
}

function isConfirmedCorrection(turn: Turn | undefined): boolean {
  return turn?.confirmed === true;
}

const emptyEffect = (): RuleEffect => ({
  fired: 0,
  sentBack: 0,
  judged: 0,
  correctedAfter: 0,
});

export function ruleEffects(
  events: RuleEvent[],
  turns: Turn[]
): Record<string, RuleEffect> {
  const effects: Record<string, RuleEffect> = {};
  for (const event of events) {
    const effect = effects[event.rule] ?? emptyEffect();
    const judge = turnAfter(event, turns);
    effect.fired += 1;
    if (event.sentBack) effect.sentBack += 1;
    if (judge) effect.judged += 1;
    if (isConfirmedCorrection(judge)) effect.correctedAfter += 1;
    effects[event.rule] = effect;
  }
  return effects;
}
