/**
 * The Relationship tab: the rule drafts waiting on the user, what the approved
 * rules did, the candidates still being proven, and the last 30 days of labelled
 * turns. A decision goes through `decideRule` or `retireRule`, the same rules the
 * CLI and the rule-review skill use.
 */

import { type Candidate, readCandidates } from "../../hooks/lib/adaptation-candidates";
import {
  type AdaptationRule,
  decideRule,
  readRules,
  retireRule,
} from "../../hooks/lib/adaptation-rules";
import { readTurns, type Turn } from "../../hooks/lib/adaptation-turns";
import {
  EFFECT_WINDOW_DAYS,
  type OpinionEffect,
  opinionEffectOf,
} from "../../hooks/lib/correction-rates";
import { gateAdvice } from "../../hooks/lib/opinion-gate";
import {
  type RuleEffect,
  readRuleEvents,
  ruleEffects,
} from "../../hooks/lib/rule-effect";
import { ordinaryTurnsNeeded } from "../../hooks/lib/rule-proof";
import type { WriteOutcome } from "./writes";

const WINDOW_DAYS = 30;
const RECENT_CORRECTIONS = 10;

export interface ActiveRule extends AdaptationRule {
  effect: RuleEffect;
  opinionEffect: OpinionEffect | null;
}

export interface DraftRule extends AdaptationRule {
  /** Why it cannot be kept as an opinion, and what to do instead. */
  gateAdvice?: string;
}

export type PageDecision = "approved" | "denied" | "opinion" | "retired";

export interface PipelineCandidate extends Candidate {
  ordinaryNeeded: number;
}

interface TurnStats {
  total: number;
  byReaction: Record<string, number>;
  confirmedCorrections: number;
  recentCorrections: { ts: string; issue: string; message: string }[];
}

export interface RelationshipView {
  windowDays: number;
  drafts: DraftRule[];
  active: ActiveRule[];
  denied: AdaptationRule[];
  pipeline: PipelineCandidate[];
  turns: TurnStats;
}

function turnStats(turns: Turn[]): TurnStats {
  const byReaction: Record<string, number> = {};
  for (const turn of turns)
    byReaction[turn.reaction] = (byReaction[turn.reaction] ?? 0) + 1;
  const confirmed = turns.filter((turn) => turn.confirmed === true);
  return {
    total: turns.length,
    byReaction,
    confirmedCorrections: confirmed.length,
    recentCorrections: confirmed
      .slice(-RECENT_CORRECTIONS)
      .reverse()
      .map(({ ts, issue, message }) => ({ ts, issue, message })),
  };
}

const NO_EFFECT: RuleEffect = { fired: 0, sentBack: 0, judged: 0, correctedAfter: 0 };

export function relationship(now: Date = new Date()): RelationshipView {
  const rules = readRules();
  const turns = readTurns(WINDOW_DAYS, now);
  const effects = ruleEffects(readRuleEvents(WINDOW_DAYS, now), turns);
  const opinionTurns = readTurns(EFFECT_WINDOW_DAYS, now);
  const withStatus = (status: AdaptationRule["status"]) =>
    rules.filter((rule) => rule.status === status);
  return {
    windowDays: WINDOW_DAYS,
    drafts: withStatus("draft").map((rule) => {
      const advice = gateAdvice(rule, rules, opinionTurns, now);
      return advice ? { ...rule, gateAdvice: advice } : rule;
    }),
    active: withStatus("approved").map((rule) => ({
      ...rule,
      effect: effects[rule.id] ?? NO_EFFECT,
      opinionEffect: opinionEffectOf(rule, rules, opinionTurns, now),
    })),
    denied: withStatus("denied"),
    pipeline: readCandidates()
      .filter((candidate) => candidate.verdict !== "passed")
      .map((candidate) => ({
        ...candidate,
        ordinaryNeeded:
          candidate.verdict === "waiting" ? ordinaryTurnsNeeded(candidate.proof) : 0,
      })),
    turns: turnStats(turns),
  };
}

export function decideFromPage(id: string, decision: PageDecision): WriteOutcome {
  const known = readRules().some((rule) => rule.id === id);
  const result = decision === "retired" ? retireRule(id) : decideRule(id, decision);
  if (result.ok) return { ok: true, changed: true };
  return { ok: false, status: known ? 409 : 404, error: result.reason };
}
