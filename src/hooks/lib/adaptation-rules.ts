/**
 * Adaptation rules: "when this happens, steer like this", learned from the
 * user's corrections. A rule starts as a draft and only steers once the user
 * approves it. A denied rule stays on record so the same rule is not drafted again.
 * An opinion is an approved rule without a trigger: it steers every session, so
 * the opinions together are capped, and a new one past the cap is refused.
 * A reinforcement is the same, learned from praise instead: a behavior to keep.
 * It has its own cap, so the two never compete for room.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

type RuleStatus = "draft" | "approved" | "denied" | "retired";
type Decision = "approved" | "denied" | "opinion";

const OPINION_CAP = 8;
const OPINION_CHARS = 1500;
const REINFORCEMENT_CAP = 5;
const REINFORCEMENT_CHARS = 700;

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
  /** Absent when the situation shows in no text a pattern could match; it can only be an opinion. */
  trigger?: RuleTrigger;
  steering: string;
  /** The correction kind the rule prevents; its rate measures the rule. */
  kind?: string;
  evidence: string[];
  /** How to tell from a reply whether the steering was followed. */
  check?: string;
  proof?: TriggerProof;
  /** The approved rule whose trigger this draft replaces with a wider one. */
  widens?: string;
  /** Its trigger failed the proof, so it can only be kept as an opinion or denied. */
  offer?: "opinion-only";
  /** Why it cannot be kept as an opinion: too few corrections of its kind, or another targets it. */
  opinionGate?: OpinionGate;
  /** Learned from praise: a behavior to keep, not a mistake to prevent. */
  polarity?: "reinforce";
  /** A later correction that asked to stop this behavior; the user decides whether to retire it. */
  contradicted?: { at: string; message: string };
}

export type OpinionGate = { corrections: number } | { duplicates: string };

export interface AdaptationRule extends DraftInput {
  id: string;
  status: RuleStatus;
  /** "always" makes an approved rule an opinion, injected every session. */
  delivery?: "always";
  createdAt: string;
  decidedAt?: string;
  retiredAt?: string;
}

function steersAlways(rule: AdaptationRule): boolean {
  return rule.status === "approved" && rule.delivery === "always";
}

export function isReinforcement(rule: AdaptationRule): boolean {
  return rule.polarity === "reinforce";
}

export function isOpinion(rule: AdaptationRule): boolean {
  return steersAlways(rule) && !isReinforcement(rule);
}

export function isApprovedReinforcement(rule: AdaptationRule): boolean {
  return steersAlways(rule) && isReinforcement(rule);
}

type Deliverable = Pick<AdaptationRule, "delivery" | "trigger"> & { status: string };

export function isTriggerRule<R extends Deliverable>(
  rule: R
): rule is R & { trigger: RuleTrigger } {
  return rule.status === "approved" && rule.delivery !== "always" && !!rule.trigger;
}

function opinionLine(rule: Pick<AdaptationRule, "when" | "steering">): string {
  return `- ${rule.when}: ${rule.steering}`;
}

function opinionsSection(rules: AdaptationRule[]): string {
  const opinions = rules.filter(isOpinion);
  if (opinions.length === 0) return "";
  return [
    "## Opinions",
    "The user approved these from past corrections. Follow them on every turn:",
    ...opinions.map(opinionLine),
  ].join("\n");
}

function reinforcementsSection(rules: AdaptationRule[]): string {
  const kept = rules.filter(isApprovedReinforcement);
  if (kept.length === 0) return "";
  return [
    "## Keep doing",
    "The user praised these and asked to keep them. Keep doing them:",
    ...kept.map(opinionLine),
  ].join("\n");
}

export function opinionsContext(): string {
  const rules = readRules();
  return [opinionsSection(rules), reinforcementsSection(rules)]
    .filter(Boolean)
    .join("\n\n");
}

function sameKindOpinion(rules: AdaptationRule[], added: AdaptationRule): string | null {
  const taken = added.kind && rules.find((r) => isOpinion(r) && r.kind === added.kind);
  return taken
    ? `Opinion ${taken.id} already targets ${added.kind}, and two would share one rate; retire it first`
    : null;
}

function opinionRefusal(rules: AdaptationRule[], added: AdaptationRule): string | null {
  const opinions = [...rules.filter(isOpinion), added];
  const sameKind = sameKindOpinion(rules, added);
  if (sameKind) return sameKind;
  if (opinions.length > OPINION_CAP)
    return `Opinions are capped at ${OPINION_CAP}; retire one first`;
  const size = opinions.map(opinionLine).join("\n").length;
  if (size > OPINION_CHARS)
    return `Opinions are capped at ${OPINION_CHARS} characters, this one would make ${size}; retire one first`;
  return null;
}

function reinforcementRefusal(
  rules: AdaptationRule[],
  added: AdaptationRule
): string | null {
  const kept = [...rules.filter(isApprovedReinforcement), added];
  if (kept.length > REINFORCEMENT_CAP)
    return `Reinforcements are capped at ${REINFORCEMENT_CAP}; retire one first`;
  const size = kept.map(opinionLine).join("\n").length;
  if (size > REINFORCEMENT_CHARS)
    return `Reinforcements are capped at ${REINFORCEMENT_CHARS} characters, this one would make ${size}; retire one first`;
  return null;
}

function alwaysRefusal(rules: AdaptationRule[], added: AdaptationRule): string | null {
  if (isApprovedReinforcement(added)) return reinforcementRefusal(rules, added);
  return isOpinion(added) ? opinionRefusal(rules, added) : null;
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

function decided(rule: AdaptationRule, decision: Decision): AdaptationRule {
  const decidedAt = new Date().toISOString();
  if (decision === "opinion" || (decision === "approved" && isReinforcement(rule)))
    return { ...rule, status: "approved", delivery: "always", decidedAt };
  return { ...rule, status: decision, decidedAt };
}

function replaceRule(rules: AdaptationRule[], rule: AdaptationRule): DecideResult {
  writeRules(rules.map((r) => (r.id === rule.id ? rule : r)));
  return { ok: true, rule };
}

function gateReason(gate: OpinionGate): string {
  return "corrections" in gate
    ? `its kind has only ${gate.corrections} corrections`
    : `${gate.duplicates} already targets its kind`;
}

function decisionRefusal(rule: AdaptationRule, decision: Decision): string | null {
  if (isReinforcement(rule))
    return decision === "opinion"
      ? `Rule ${rule.id} is a reinforcement; approve or deny it`
      : null;
  if (decision === "opinion" && rule.widens)
    return `Rule ${rule.id} widens a trigger; it cannot be an opinion`;
  if (decision === "opinion" && !rule.kind)
    return `Rule ${rule.id} has no correction kind, so its effect could not be measured`;
  if (decision === "opinion" && rule.opinionGate)
    return `Rule ${rule.id} cannot be an opinion: ${gateReason(rule.opinionGate)}`;
  if (decision === "approved" && !rule.trigger)
    return `Rule ${rule.id} has no trigger; keep it as an opinion or deny it`;
  if (decision === "approved" && rule.offer === "opinion-only")
    return `Rule ${rule.id}'s trigger did not prove; keep it as an opinion or deny it`;
  return null;
}

export function decideRule(id: string, decision: Decision): DecideResult {
  const rules = readRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) return { ok: false, reason: `No rule with id ${id}` };
  if (rule.status !== "draft")
    return { ok: false, reason: `Rule ${id} was already ${rule.status}` };
  const refused = decisionRefusal(rule, decision);
  if (refused) return { ok: false, reason: refused };
  if (rule.widens && decision === "approved") return approveWidening(rules, rule);
  const result = decided(rule, decision);
  const refusal = alwaysRefusal(rules, result);
  return refusal ? { ok: false, reason: refusal } : replaceRule(rules, result);
}

export interface OpinionInput {
  when: string;
  steering: string;
  kind: string;
  evidence: string[];
}

export function addOpinion(input: OpinionInput): DecideResult {
  const now = new Date().toISOString();
  const opinion: AdaptationRule = {
    ...input,
    id: randomUUID().slice(0, 8),
    status: "approved",
    delivery: "always",
    createdAt: now,
    decidedAt: now,
  };
  const rules = readRules();
  const refusal = opinionRefusal(rules, opinion);
  if (refusal) return { ok: false, reason: refusal };
  writeRules([...rules, opinion]);
  return { ok: true, rule: opinion };
}

export interface ReinforcementInput {
  when: string;
  steering: string;
  evidence: string[];
}

export function addReinforcement(input: ReinforcementInput): DecideResult {
  const now = new Date().toISOString();
  const kept: AdaptationRule = {
    ...input,
    polarity: "reinforce",
    id: randomUUID().slice(0, 8),
    status: "approved",
    delivery: "always",
    createdAt: now,
    decidedAt: now,
  };
  const rules = readRules();
  const refusal = reinforcementRefusal(rules, kept);
  if (refusal) return { ok: false, reason: refusal };
  writeRules([...rules, kept]);
  return { ok: true, rule: kept };
}

export function flagContradiction(id: string, message: string): void {
  const contradicted = { at: new Date().toISOString(), message };
  writeRules(readRules().map((r) => (r.id === id ? { ...r, contradicted } : r)));
}

export function retireRule(id: string): DecideResult {
  const rules = readRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) return { ok: false, reason: `No rule with id ${id}` };
  if (rule.status !== "approved")
    return { ok: false, reason: `Rule ${id} is ${rule.status}, not approved` };
  return replaceRule(rules, {
    ...rule,
    status: "retired",
    retiredAt: new Date().toISOString(),
  });
}
