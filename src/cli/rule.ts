/**
 * pal cli rule — review the adaptation rules drafted from the user's corrections.
 *
 * Subcommands:
 *   list [--all] [--json]   Drafts waiting for a decision (--all: every rule)
 *   approve <id>            Turn a draft into a rule that steers
 *   opinion <id>            Keep a draft as an opinion, steering every session
 *   deny <id>               Reject a draft; it stays on record so it is not redrafted
 *   retire <id>             End an approved rule or opinion
 *   add-opinion --kind K --when W --steering S [--evidence E]
 */

import {
  type AdaptationRule,
  addOpinion,
  decideRule,
  isOpinion,
  readRules,
  retireRule,
  type TriggerProof,
} from "../hooks/lib/adaptation-rules";
import { readTurns, type Turn } from "../hooks/lib/adaptation-turns";
import { CORRECTION_KINDS, type CorrectionKindName } from "../hooks/lib/correction-kind";
import {
  EFFECT_WINDOW_DAYS,
  type OpinionEffect,
  opinionEffectOf,
} from "../hooks/lib/correction-rates";
import { gateAdvice } from "../hooks/lib/opinion-gate";
import { group, leaf, runCommand, UsageError } from "../tools/lib/command";

type DecideResult = ReturnType<typeof decideRule>;

export const ruleCommand = group({
  summary: "Review the rules PAL drafted from your corrections",
  commands: {
    list: leaf({
      summary: "Drafts waiting for a decision",
      options: {
        all: { type: "boolean", description: "Every rule, not only the drafts" },
        json: { type: "boolean", description: "Machine-readable output" },
      },
      run: ({ values }) => cmdList(values.all === true, values.json === true),
    }),
    approve: leaf({
      summary: "Approve a draft so it steers",
      args: "<id>",
      run: ({ positionals }) =>
        report(positionals[0], decideRule(positionals[0], "approved")),
    }),
    opinion: leaf({
      summary: "Keep a draft as an opinion, steering every session without a trigger",
      args: "<id>",
      run: ({ positionals }) =>
        report(positionals[0], decideRule(positionals[0], "opinion")),
    }),
    deny: leaf({
      summary: "Deny a draft; it stays on record so it is not drafted again",
      args: "<id>",
      run: ({ positionals }) =>
        report(positionals[0], decideRule(positionals[0], "denied")),
    }),
    retire: leaf({
      summary: "End an approved rule or opinion",
      args: "<id>",
      run: ({ positionals }) => report(positionals[0], retireRule(positionals[0])),
    }),
    "add-opinion": leaf({
      summary: "Write an opinion by hand; it is approved at once",
      options: {
        kind: { type: "string", description: "The correction kind it prevents" },
        when: { type: "string", description: "The situation, in one sentence" },
        steering: { type: "string", description: "The instruction, imperative" },
        evidence: { type: "string", description: "Why it is needed" },
      },
      run: ({ values }) =>
        cmdAddOpinion(values.kind, values.when, values.steering, values.evidence),
    }),
  },
});

export function runRule(args: string[]): Promise<number> {
  return runCommand(ruleCommand, args, ["pal", "cli", "rule"]);
}

function cmdList(all: boolean, json: boolean): number {
  const rules = readRules().filter((r) => all || r.status === "draft");
  if (json) {
    console.log(JSON.stringify(rules, null, 2));
    return 0;
  }
  if (rules.length === 0) {
    console.log(all ? "No rules yet." : "No drafts waiting.");
    return 0;
  }
  const measure: Measure = { turns: readTurns(EFFECT_WINDOW_DAYS), rules: readRules() };
  console.log(rules.map((rule) => formatRule(rule, measure)).join("\n\n"));
  return 0;
}

interface Measure {
  turns: Turn[];
  rules: AdaptationRule[];
}

function formatRule(rule: AdaptationRule, measure: Measure): string {
  const label = isOpinion(rule) ? "opinion" : rule.status;
  return [
    `${rule.id}  [${label}]  ${rule.when}`,
    ...(rule.widens ? [`  widens: ${rule.widens}`] : []),
    ...(rule.trigger
      ? [`  trigger (${rule.trigger.side}): ${rule.trigger.pattern}`]
      : []),
    `  steering: ${rule.steering}`,
    ...(rule.kind ? [`  kind: ${rule.kind}`] : []),
    ...(rule.check ? [`  check: ${rule.check}`] : []),
    ...(rule.proof ? [`  proof: ${formatProof(rule.proof)}`] : []),
    ...offerLines(rule),
    ...gateLines(rule, measure),
    ...effectLines(rule, measure),
    ...rule.evidence.map((e) => `  evidence: ${e}`),
  ].join("\n");
}

function offerLines(rule: AdaptationRule): string[] {
  if (rule.offer !== "opinion-only" || rule.status !== "draft" || rule.opinionGate)
    return [];
  const why = rule.trigger ? "the trigger did not prove" : "no trigger";
  return [`  offer: ${why}; keep it as an opinion or deny it`];
}

function gateLines(rule: AdaptationRule, { turns, rules }: Measure): string[] {
  const advice = gateAdvice(rule, rules, turns);
  return advice ? [`  no opinion: ${advice}`] : [];
}

function effectLines(rule: AdaptationRule, { turns, rules }: Measure): string[] {
  const effect = opinionEffectOf(rule, rules, turns);
  if (!effect) return [];
  return [
    `  effect: ${formatWindows(effect)} (${effect.verdict})`,
    `  other kinds: ${formatWindows(effect.control)}`,
  ];
}

function formatWindows({
  before,
  after,
}: Pick<OpinionEffect, "before" | "after">): string {
  return `${before.count} in ${before.turns} turns before (${before.per100.toFixed(1)}/100), ${after.count} in ${after.turns} after (${after.per100.toFixed(1)}/100)`;
}

function formatProof(proof: TriggerProof): string {
  return `fired on ${proof.firedCorrections}/${proof.corrections} corrections, ${proof.firedOrdinary}/${proof.ordinary} ordinary turns`;
}

function resultLine(id: string, rule: AdaptationRule): string {
  if (rule.id !== id)
    return `Rule ${rule.id} now triggers on: ${rule.trigger?.pattern} (widened by ${id})`;
  const label = isOpinion(rule) ? "kept as an opinion" : rule.status;
  return `Rule ${id} ${label}: ${rule.when}`;
}

function report(id: string, result: DecideResult): number {
  if (!result.ok) {
    console.error(result.reason);
    return 1;
  }
  console.log(resultLine(id, result.rule));
  return 0;
}

function correctionKind(kind: string | undefined): CorrectionKindName {
  if (CORRECTION_KINDS.includes(kind as CorrectionKindName))
    return kind as CorrectionKindName;
  throw new UsageError(`--kind must be one of ${CORRECTION_KINDS.join(", ")}`);
}

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new UsageError(`--${name} is required`);
  return value.trim();
}

function cmdAddOpinion(
  kind: string | undefined,
  when: string | undefined,
  steering: string | undefined,
  evidence: string | undefined
): number {
  const result = addOpinion({
    kind: correctionKind(kind),
    when: required("when", when),
    steering: required("steering", steering),
    evidence: evidence?.trim() ? [evidence.trim()] : [],
  });
  return report(result.ok ? result.rule.id : "", result);
}
