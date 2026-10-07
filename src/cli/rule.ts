/**
 * pal cli rule — review the adaptation rules drafted from the user's corrections.
 *
 * Subcommands:
 *   list [--all] [--json]   Drafts waiting for a decision (--all: every rule)
 *   approve <id>            Turn a draft into a rule that steers
 *   deny <id>               Reject a draft; it stays on record so it is not redrafted
 */

import {
  type AdaptationRule,
  decideRule,
  type RuleStatus,
  readRules,
  type TriggerProof,
} from "../hooks/lib/adaptation-rules";
import { group, leaf, runCommand } from "../tools/lib/command";

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
      run: ({ positionals }) => cmdDecide(positionals[0], "approved"),
    }),
    deny: leaf({
      summary: "Deny a draft; it stays on record so it is not drafted again",
      args: "<id>",
      run: ({ positionals }) => cmdDecide(positionals[0], "denied"),
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
  console.log(rules.map(formatRule).join("\n\n"));
  return 0;
}

function formatRule(rule: AdaptationRule): string {
  return [
    `${rule.id}  [${rule.status}]  ${rule.when}`,
    ...(rule.widens ? [`  widens: ${rule.widens}`] : []),
    `  trigger (${rule.trigger.side}): ${rule.trigger.pattern}`,
    `  steering: ${rule.steering}`,
    ...(rule.check ? [`  check: ${rule.check}`] : []),
    ...(rule.proof ? [`  proof: ${formatProof(rule.proof)}`] : []),
    ...rule.evidence.map((e) => `  evidence: ${e}`),
  ].join("\n");
}

function formatProof(proof: TriggerProof): string {
  return `fired on ${proof.firedCorrections}/${proof.corrections} corrections, ${proof.firedOrdinary}/${proof.ordinary} ordinary turns`;
}

function decisionLine(id: string, decision: string, rule: AdaptationRule): string {
  if (rule.id === id) return `Rule ${id} ${decision}: ${rule.when}`;
  return `Rule ${rule.id} now triggers on: ${rule.trigger.pattern} (widened by ${id})`;
}

function cmdDecide(id: string, decision: Exclude<RuleStatus, "draft">): number {
  const result = decideRule(id, decision);
  if (!result.ok) {
    console.error(result.reason);
    return 1;
  }
  console.log(decisionLine(id, decision, result.rule));
  return 0;
}
