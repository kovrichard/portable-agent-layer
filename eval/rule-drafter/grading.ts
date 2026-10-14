/**
 * Grades one drafter output for one case with the parser and trigger matcher
 * that ship, so a pass means the draft would become a candidate and pass the
 * proof over the given turns.
 */
import type { CandidateInput } from "../../src/hooks/lib/adaptation-candidates";
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
  draft: CandidateInput,
  newest: RequestedTurn,
  proofTurns: RequestedTurn[]
): string[] {
  const proof = proveTrigger(draft.trigger, proofTurns);
  const verdict = draft.widens ? widenedProofVerdict(proof) : proofVerdict(proof);
  const shown = `/${draft.trigger.pattern}/`;
  return [
    ...(firesOn(draft.trigger, newest) ? [] : [`${shown} misses the newest`]),
    ...(verdict === "passed"
      ? []
      : [
          `${shown} ${verdict} the proof: ${proof.firedCorrections}/${proof.corrections} corrections, ${proof.firedOrdinary}/${proof.ordinary} ordinary`,
        ]),
  ];
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
    ...("widens" in c.expect && draft.widens !== c.expect.widens
      ? [`widens ${draft.widens ?? "nothing"}, wanted ${c.expect.widens}`]
      : []),
    ...("mustCite" in c.expect && draft.widens ? [`widened ${draft.widens}`] : []),
    ...citeProblems(raw.cites ?? [], c),
    ...triggerProblems(draft, corrections[corrections.length - 1], proofTurns),
  ];
  return {
    pass: problems.length === 0,
    reason: problems.join("; ") || `${draft.trigger.side}: /${draft.trigger.pattern}/`,
  };
}

export function gradeNext(c: DrafterCase, output: string): Grade {
  if (!c.next) return { pass: true, reason: "no later correction" };
  const draft = parseDraft(output, asTurns(c.corrections), c.known ?? []);
  if (!draft) return { pass: false, reason: "no trigger to try" };
  const [next] = asTurns([c.next]);
  const pass = firesOn(draft.trigger, next);
  return {
    pass,
    reason: `/${draft.trigger.pattern}/ ${pass ? "catches" : "misses"} the next one`,
  };
}
