/**
 * The shadow numbers for the run checks: run types, exemptions, would-nudge verdicts
 * per check, and one case per verdict to label.
 */

import type { RunRecord } from "./algorithm-run-replay";

export interface CheckedTurn {
  ts: string;
  run?: string | null;
  node: string | null;
  turn: string | null;
  project?: string | null;
  runType?: string[];
  wouldNudge?: string[];
  exempt?: string | null;
}

interface CheckCase {
  date: string;
  project: string | null;
  node: string | null;
  nodeTitle: string | null;
  runType: string[];
  check: string;
  turn: string | null;
  reflectedLater: boolean;
}

export interface CheckReport {
  checkedTurns: number;
  runTypes: Record<string, number>;
  exempt: Record<string, number>;
  verdicts: Record<string, number>;
  reflectedLater: number;
  cases: CheckCase[];
}

function tally(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function wasChecked(turn: CheckedTurn): boolean {
  return Array.isArray(turn.wouldNudge);
}

/** A run that a later turn finished was reflected after all; the case stays, marked. */
function finishedLater(
  turn: CheckedTurn,
  check: string,
  runs: Record<string, RunRecord>
): boolean {
  if (check !== "no-reflection" || !turn.run) return false;

  return runs[turn.run]?.outcome === "finished";
}

function casesOf(
  turn: CheckedTurn,
  runs: Record<string, RunRecord>,
  nodeTitle: (node: string) => string | null
): CheckCase[] {
  return (turn.wouldNudge ?? []).map((check) => ({
    date: turn.ts.slice(0, 10),
    project: turn.project ?? null,
    node: turn.node,
    nodeTitle: turn.node ? nodeTitle(turn.node) : null,
    runType: turn.runType ?? [],
    check,
    turn: turn.turn,
    reflectedLater: finishedLater(turn, check, runs),
  }));
}

export function checkReport(
  turns: CheckedTurn[],
  runs: Record<string, RunRecord>,
  nodeTitle: (node: string) => string | null
): CheckReport {
  const checked = turns.filter(wasChecked);
  const runTypes: Record<string, number> = {};
  const exempt: Record<string, number> = {};
  const verdicts: Record<string, number> = {};

  for (const turn of checked) {
    if (turn.runType?.length) tally(runTypes, turn.runType.join("+"));

    if (turn.exempt) tally(exempt, turn.exempt);

    for (const check of turn.wouldNudge ?? []) tally(verdicts, check);
  }

  const cases = checked.flatMap((turn) => casesOf(turn, runs, nodeTitle));

  return {
    checkedTurns: checked.length,
    runTypes,
    exempt,
    verdicts,
    reflectedLater: cases.filter((c) => c.reflectedLater).length,
    cases,
  };
}
