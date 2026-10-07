/**
 * The Relationship tab: the rule drafts waiting on the user, what the approved
 * rules did, the candidates still being proven, and the last 30 days of labelled
 * turns. A decision goes through `decideRule`, the same rule the CLI and the
 * rule-review skill use.
 */

import { type Candidate, readCandidates } from "../../hooks/lib/adaptation-candidates";
import {
  type AdaptationRule,
  decideRule,
  readRules,
} from "../../hooks/lib/adaptation-rules";
import { readTurns, type Turn } from "../../hooks/lib/adaptation-turns";
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
}

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
  drafts: AdaptationRule[];
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
  const withStatus = (status: AdaptationRule["status"]) =>
    rules.filter((rule) => rule.status === status);
  return {
    windowDays: WINDOW_DAYS,
    drafts: withStatus("draft"),
    active: withStatus("approved").map((rule) => ({
      ...rule,
      effect: effects[rule.id] ?? NO_EFFECT,
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

export function decideFromPage(
  id: string,
  decision: "approved" | "denied"
): WriteOutcome {
  const known = readRules().some((rule) => rule.id === id);
  const result = decideRule(id, decision);
  if (result.ok) return { ok: true, changed: true };
  return { ok: false, status: known ? 409 : 404, error: result.reason };
}
