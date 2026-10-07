/**
 * Adaptation rules: "when this happens, steer like this", learned from the
 * user's corrections. A rule starts as a draft and only steers once the user
 * approves it. A denied rule stays on record so the same rule is not drafted again.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

export type RuleStatus = "draft" | "approved" | "denied";
type Decision = Exclude<RuleStatus, "draft">;

export interface RuleTrigger {
  /** Whether the pattern is matched against the user's prompt or the assistant's reply. */
  side: "prompt" | "reply";
  pattern: string;
}

/** Where the trigger fired when replayed over the turn log. */
export interface TriggerProof {
  firedCorrections: number;
  corrections: number;
  firedOrdinary: number;
  ordinary: number;
}

export interface DraftInput {
  when: string;
  trigger: RuleTrigger;
  steering: string;
  evidence: string[];
  /** How to tell from a reply whether the steering was followed. */
  check?: string;
  proof?: TriggerProof;
  /** The approved rule whose trigger this draft replaces with a wider one. */
  widens?: string;
}

export interface AdaptationRule extends DraftInput {
  id: string;
  status: RuleStatus;
  createdAt: string;
  decidedAt?: string;
}

type DecideResult = { ok: true; rule: AdaptationRule } | { ok: false; reason: string };

export function rulesPath(): string {
  return resolve(paths.adaptation(), "rules.json");
}

export function readRules(): AdaptationRule[] {
  const path = rulesPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(parsed) ? (parsed as AdaptationRule[]) : [];
  } catch {
    return [];
  }
}

function writeRules(rules: AdaptationRule[]): void {
  const path = rulesPath();
  const pending = `${path}.${process.pid}.tmp`;
  writeFileSync(pending, `${JSON.stringify(rules, null, 2)}\n`, "utf-8");
  renameSync(pending, path);
}

export function addDraft(input: DraftInput): AdaptationRule {
  const rule: AdaptationRule = {
    ...input,
    id: randomUUID().slice(0, 8),
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  writeRules([...readRules(), rule]);
  return rule;
}

function approveWidening(
  rules: AdaptationRule[],
  widening: AdaptationRule
): DecideResult {
  const target = rules.find((r) => r.id === widening.widens);
  if (target?.status !== "approved")
    return { ok: false, reason: `Rule ${widening.widens} is not an approved rule` };
  const widened: AdaptationRule = {
    ...target,
    trigger: widening.trigger,
    evidence: [...target.evidence, ...widening.evidence],
    proof: widening.proof,
  };
  writeRules(
    rules
      .filter((r) => r.id !== widening.id)
      .map((r) => (r.id === target.id ? widened : r))
  );
  return { ok: true, rule: widened };
}

export function decideRule(id: string, decision: Decision): DecideResult {
  const rules = readRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) return { ok: false, reason: `No rule with id ${id}` };
  if (rule.status !== "draft")
    return { ok: false, reason: `Rule ${id} was already ${rule.status}` };
  if (rule.widens && decision === "approved") return approveWidening(rules, rule);
  const decided: AdaptationRule = {
    ...rule,
    status: decision,
    decidedAt: new Date().toISOString(),
  };
  writeRules(rules.map((r) => (r.id === id ? decided : r)));
  return { ok: true, rule: decided };
}
