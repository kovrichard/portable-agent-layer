/**
 * Whether a draft may be kept as an opinion. Opinions steer every session, so
 * one is offered only once its kind has recurred enough to be measured, and
 * only while no opinion or undecided draft already targets that kind: a second
 * one would share its rate.
 */

import { type AdaptationRule, isOpinion, type OpinionGate } from "./adaptation-rules";
import type { Turn } from "./adaptation-turns";
import { hasCurrentKind } from "./correction-kind";
import { type OpinionEffect, opinionEffectOf } from "./correction-rates";

const MIN_KIND_CORRECTIONS = 5;

function correctionsOfKind(kind: string, turns: Turn[]): number {
  return turns.filter(
    (turn) =>
      turn.confirmed === true && hasCurrentKind(turn) && turn.correctionKind.kind === kind
  ).length;
}

function offersOpinion(rule: AdaptationRule): boolean {
  return rule.status === "draft" && !rule.widens && !rule.opinionGate;
}

function sameKind(kind: string, rules: AdaptationRule[]): AdaptationRule | undefined {
  return rules.find((r) => r.kind === kind && (isOpinion(r) || offersOpinion(r)));
}

export function opinionGate(
  kind: string,
  rules: AdaptationRule[],
  turns: Turn[]
): OpinionGate | undefined {
  const taken = sameKind(kind, rules);
  if (taken) return { duplicates: taken.id };
  const corrections = correctionsOfKind(kind, turns);
  return corrections < MIN_KIND_CORRECTIONS ? { corrections } : undefined;
}

function opinionAdvice(id: string, effect: OpinionEffect | null): string {
  if (effect?.verdict === "lower")
    return `opinion ${id} lowers its kind, so this is a variant; promote ${id} to a lasting principle to free its slot`;
  if (effect?.verdict === "not-lower")
    return `opinion ${id} is not lowering its kind; reword ${id} instead of adding another`;
  return `opinion ${id}'s effect is not measurable yet (${effect?.verdict ?? "no effect"}); held beside it`;
}

function duplicateAdvice(
  id: string,
  rules: AdaptationRule[],
  turns: Turn[],
  now: Date
): string {
  const target = rules.find((r) => r.id === id);
  if (target && isOpinion(target))
    return opinionAdvice(id, opinionEffectOf(target, rules, turns, now));
  if (target?.status === "draft")
    return `draft ${id} already offers an opinion for this kind; decide it first`;
  return `${id} targeted this kind and is no longer active`;
}

export function gateAdvice(
  rule: AdaptationRule,
  rules: AdaptationRule[],
  turns: Turn[],
  now: Date = new Date()
): string | undefined {
  const gate = rule.status === "draft" ? rule.opinionGate : undefined;
  if (!gate) return undefined;
  if ("duplicates" in gate) return duplicateAdvice(gate.duplicates, rules, turns, now);
  return `${gate.corrections} corrections of its kind so far; an opinion needs ${MIN_KIND_CORRECTIONS}`;
}
