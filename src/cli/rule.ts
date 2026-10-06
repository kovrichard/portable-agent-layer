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
} from "../hooks/lib/adaptation-rules";

const DECISIONS: Record<string, Exclude<RuleStatus, "draft">> = {
  approve: "approved",
  deny: "denied",
};

export async function runRule(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "list") return cmdList(rest);
  if (sub && sub in DECISIONS) return cmdDecide(rest[0], DECISIONS[sub]);
  showHelp();
  return sub === undefined || sub === "help" ? 0 : 1;
}

function cmdList(args: string[]): number {
  const all = args.includes("--all");
  const rules = readRules().filter((r) => all || r.status === "draft");
  if (args.includes("--json")) {
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
    `  trigger (${rule.trigger.side}): ${rule.trigger.pattern}`,
    `  steering: ${rule.steering}`,
    ...rule.evidence.map((e) => `  evidence: ${e}`),
  ].join("\n");
}

function cmdDecide(
  id: string | undefined,
  decision: Exclude<RuleStatus, "draft">
): number {
  if (!id) {
    console.error("Give the rule id: pal cli rule approve|deny <id>");
    return 1;
  }
  const result = decideRule(id, decision);
  if (!result.ok) {
    console.error(result.reason);
    return 1;
  }
  console.log(`Rule ${id} ${decision}: ${result.rule.when}`);
  return 0;
}

function showHelp(): void {
  console.log(`pal cli rule — review adaptation rules drafted from your corrections

  pal cli rule list [--all] [--json]   Drafts waiting for a decision
  pal cli rule approve <id>            Approve a draft so it steers
  pal cli rule deny <id>               Deny a draft; it is not drafted again`);
}
