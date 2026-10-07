/**
 * Approved adaptation rules at work: a prompt-side rule is injected when its
 * trigger matches the user's prompt; a reply-side rule sends a matching reply
 * back once at stop. Every fire is logged so a rule's effect can be measured.
 */

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AdaptationRule, type RuleTrigger, readRules } from "./adaptation-rules";
import { alreadySentBack } from "./claim-log";
import { hookFinalReply, hookSessionId } from "./hook-turn";
import { replyEnd } from "./interaction-samples";
import { paths } from "./paths";
import { isEnabled } from "./settings";
import type { StopTurnPayload } from "./stop";

const REMINDER_MAX = 1500;
const REMINDER_HEADER =
  "Rules the user approved from past corrections — follow them on this turn:";

type Side = RuleTrigger["side"];

function triggers(rule: AdaptationRule, side: Side, text: string): boolean {
  if (rule.status !== "approved" || rule.trigger.side !== side) return false;
  try {
    return new RegExp(rule.trigger.pattern, "i").test(text);
  } catch {
    return false;
  }
}

function firingRules(side: Side, text: string): AdaptationRule[] {
  if (!isEnabled("adaptationRules") || !text) return [];
  return readRules().filter((rule) => triggers(rule, side, text));
}

function logFire(
  rules: AdaptationRule[],
  side: Side,
  session: string,
  now: Date,
  sentBack?: boolean
): void {
  const lines = rules.map((rule) =>
    JSON.stringify({ ts: now.toISOString(), rule: rule.id, side, session, sentBack })
  );
  appendFileSync(
    resolve(paths.adaptation(), "rule-events.jsonl"),
    `${lines.join("\n")}\n`
  );
}

function withinBudget(rules: AdaptationRule[]): AdaptationRule[] {
  let size = REMINDER_HEADER.length + "<system-reminder>\n\n</system-reminder>".length;
  return rules.filter((rule) => {
    size += rule.steering.length + 3;
    return size <= REMINDER_MAX;
  });
}

export function promptRulesReminder(
  prompt: string,
  sessionId?: string,
  now: Date = new Date()
): string | null {
  const fired = withinBudget(firingRules("prompt", prompt));
  if (fired.length === 0) return null;
  logFire(fired, "prompt", sessionId ?? "unknown", now);
  return [
    "<system-reminder>",
    REMINDER_HEADER,
    ...fired.map((rule) => `- ${rule.steering}`),
    "</system-reminder>",
  ].join("\n");
}

function sendBackReason(rules: AdaptationRule[]): string {
  const steering = rules.map((rule) => rule.steering).join(" ");
  return `Your reply matches a rule the user approved from past corrections. ${steering}`;
}

export function watchReplyRules(
  payload: StopTurnPayload | null,
  now: Date = new Date()
): string | null {
  const fired = firingRules("reply", replyEnd(hookFinalReply(payload) ?? ""));
  if (!payload || fired.length === 0) return null;
  const sentBack = !alreadySentBack(payload);
  logFire(fired, "reply", hookSessionId(payload) ?? "unknown", now, sentBack);
  return sentBack ? sendBackReason(fired) : null;
}
