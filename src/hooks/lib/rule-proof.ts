/**
 * The proof: replay a candidate's trigger over the turn log. A trigger earns a
 * draft when it fires on repeated corrections and stays quiet on ordinary turns.
 */

import type { RuleTrigger, TriggerProof } from "./adaptation-rules";
import type { RequestedTurn } from "./adaptation-turns";

const MIN_FIRED_CORRECTIONS = 2;
const MIN_FIRED_FOR_WIDENING = 1;
const MAX_ORDINARY_FIRE_RATE = 0.1;
const MIN_ORDINARY_TURNS = 20;

export type ProofVerdict = "passed" | "failed" | "waiting";

const CORRECTION_REACTIONS = new Set(["corrected", "repeated"]);

function isConfirmedCorrection(turn: RequestedTurn): boolean {
  return CORRECTION_REACTIONS.has(turn.reaction) && turn.confirmed === true;
}

function isOrdinary(turn: RequestedTurn): boolean {
  return !CORRECTION_REACTIONS.has(turn.reaction);
}

function triggerText(trigger: RuleTrigger, turn: RequestedTurn): string {
  return trigger.side === "reply" ? turn.replyEnd : turn.prompt;
}

export function firesOn(trigger: RuleTrigger, turn: RequestedTurn): boolean {
  return new RegExp(trigger.pattern, "i").test(triggerText(trigger, turn));
}

export function proveTrigger(trigger: RuleTrigger, turns: RequestedTurn[]): TriggerProof {
  const testable = turns.filter((turn) => triggerText(trigger, turn) !== "");
  const fires = (turn: RequestedTurn) => firesOn(trigger, turn);
  const corrections = testable.filter(isConfirmedCorrection);
  const ordinary = testable.filter(isOrdinary);
  return {
    firedCorrections: corrections.filter(fires).length,
    corrections: corrections.length,
    firedOrdinary: ordinary.filter(fires).length,
    ordinary: ordinary.length,
  };
}

export function ordinaryTurnsNeeded(proof: TriggerProof): number {
  return Math.max(0, MIN_ORDINARY_TURNS - proof.ordinary);
}

export function proofVerdict(proof: TriggerProof): ProofVerdict {
  return verdictFiringOn(MIN_FIRED_CORRECTIONS, proof);
}

export function widenedProofVerdict(proof: TriggerProof): ProofVerdict {
  return verdictFiringOn(MIN_FIRED_FOR_WIDENING, proof);
}

function verdictFiringOn(minFiredCorrections: number, proof: TriggerProof): ProofVerdict {
  if (proof.firedCorrections < minFiredCorrections) return "failed";
  if (proof.ordinary < MIN_ORDINARY_TURNS) return "waiting";
  return proof.firedOrdinary <= proof.ordinary * MAX_ORDINARY_FIRE_RATE
    ? "passed"
    : "failed";
}
