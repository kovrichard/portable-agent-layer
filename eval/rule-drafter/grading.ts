/**
 * Grades one drafter output for one case with the parser and trigger matcher
 * that ship. A new draft is graded on whether it drafted and what it cited: it
 * is an opinion unless its optional trigger proves, which is graded apart. A
 * widening must fire on the newest correction and pass the proof.
 */
import type { CandidateInput } from "../../src/hooks/lib/adaptation-candidates";
import type { RuleTrigger } from "../../src/hooks/lib/adaptation-rules";
import type { RequestedTurn } from "../../src/hooks/lib/adaptation-turns";
import { parseDraft } from "../../src/hooks/lib/rule-drafter";
import {
  firesOn,
  proofVerdict,
  proveTrigger,
  widenedProofVerdict,
} from "../../src/hooks/lib/rule-proof";
import { asTurns, type DrafterCase } from "./cases";

export interface Grade {
  pass: boolean;
  reason: string;
}

interface RawDraft {
  recurring?: boolean;
  cites?: number[];
  reason?: string;
}

function parseRaw(output: string): RawDraft | null {
  try {
    return JSON.parse(/\{[\s\S]*\}/.exec(output)?.[0] ?? "") as RawDraft;
  } catch {
    return null;
  }
}

function citeProblems(cites: number[], c: DrafterCase): string[] {
  if (!("mustCite" in c.expect)) return [];
  const { mustCite, mustNotCite = [] } = c.expect;
  return [
    ...mustCite.filter((n) => !cites.includes(n)).map((n) => `did not cite ${n}`),
    ...mustNotCite.filter((n) => cites.includes(n)).map((n) => `cited ${n}`),
  ];
}

function triggerProblems(
  trigger: RuleTrigger,
  widens: string | undefined,
  newest: RequestedTurn,
  proofTurns: RequestedTurn[]
): string[] {
  const proof = proveTrigger(trigger, proofTurns);
  const verdict = widens ? widenedProofVerdict(proof) : proofVerdict(proof);
  const shown = `/${trigger.pattern}/`;
  return [
    ...(firesOn(trigger, newest) ? [] : [`${shown} misses the newest`]),
    ...(verdict === "passed"
      ? []
      : [
          `${shown} ${verdict} the proof: ${proof.firedCorrections}/${proof.corrections} corrections, ${proof.firedOrdinary}/${proof.ordinary} ordinary`,
        ]),
  ];
}

function wideningProblems(
  draft: CandidateInput,
  newest: RequestedTurn,
  proofTurns: RequestedTurn[]
): string[] {
  if (!draft.widens) return [];
  if (!draft.trigger) return ["a widening without a trigger"];
  return triggerProblems(draft.trigger, draft.widens, newest, proofTurns);
}

function expectationProblems(draft: CandidateInput, c: DrafterCase): string[] {
  if ("widens" in c.expect && draft.widens !== c.expect.widens)
    return [`widens ${draft.widens ?? "nothing"}, wanted ${c.expect.widens}`];
  if ("mustCite" in c.expect && draft.widens) return [`widened ${draft.widens}`];
  return [];
}

function shownDraft(draft: CandidateInput): string {
  const trigger = draft.trigger
    ? `${draft.trigger.side}: /${draft.trigger.pattern}/`
    : "no trigger";
  return `${draft.when} -> ${draft.steering} (${trigger})`;
}

export function grade(
  c: DrafterCase,
  output: string,
  proofTurns: RequestedTurn[]
): Grade {
  const raw = parseRaw(output);
  if (!raw) return { pass: false, reason: "not JSON" };
  const corrections = asTurns(c.corrections);
  if ("recurring" in c.expect && !c.expect.recurring) {
    const pass = raw.recurring === false;
    return { pass, reason: pass ? "not recurring" : `drafted: cites ${raw.cites}` };
  }
  const draft = parseDraft(output, corrections, c.known ?? []);
  if (!draft) return { pass: false, reason: `no valid draft: ${raw.reason ?? ""}` };
  const problems = [
    ...expectationProblems(draft, c),
    ...citeProblems(raw.cites ?? [], c),
    ...wideningProblems(draft, corrections[corrections.length - 1], proofTurns),
  ];
  return {
    pass: problems.length === 0,
    reason: problems.join("; ") || shownDraft(draft),
  };
}

/** Whether a new draft's optional trigger would make it a rule; a draft without one passes as an opinion. */
export function gradeTrigger(
  c: DrafterCase,
  output: string,
  proofTurns: RequestedTurn[]
): Grade & { tried: boolean } {
  const corrections = asTurns(c.corrections);
  const draft = parseDraft(output, corrections, c.known ?? []);
  if (!draft?.trigger || draft.widens)
    return { pass: true, tried: false, reason: "no trigger to prove" };
  const problems = triggerProblems(
    draft.trigger,
    undefined,
    corrections[corrections.length - 1],
    proofTurns
  );
  return {
    pass: problems.length === 0,
    tried: true,
    reason: problems.join("; ") || `/${draft.trigger.pattern}/ proves`,
  };
}

export function gradeNext(c: DrafterCase, output: string): Grade {
  if (!c.next) return { pass: true, reason: "no later correction" };
  const draft = parseDraft(output, asTurns(c.corrections), c.known ?? []);
  if (!draft) return { pass: false, reason: "no draft" };
  if (!draft.trigger) return { pass: true, reason: "an opinion, no trigger to try" };
  const [next] = asTurns([c.next]);
  const pass = firesOn(draft.trigger, next);
  return {
    pass,
    reason: `/${draft.trigger.pattern}/ ${pass ? "catches" : "misses"} the next one`,
  };
}
