/**
 * The shadow numbers for ALGORITHM runs, counted from their events.
 */

import { lastPhase, PHASES } from "./algorithm-run-facts";
import { type RunEvent, type RunRecord, replayRuns } from "./algorithm-run-replay";
import { shellKnowsSession } from "./progress-session";

export interface ReportedEvent extends RunEvent {
  project?: string | null;
  runtime?: string;
  verdict?: string;
  startsNew?: boolean;
}

interface OverOpenRunCase {
  date: string;
  project: string | null;
  node: string | null;
  nodeTitle: string | null;
  oldPhases: string[];
  observe: boolean;
  oldTurn: string | null;
  newTurn: string | null;
}

export interface AlgorithmRunReport {
  algorithmTurns: number;
  taggedByReplyMode: number;
  runs: { started: number; finished: number; superseded: number; open: number };
  finishedWithAllPhases: number;
  verdicts: Record<string, number>;
  noNodeShare: number | null;
  unreflectedByLastPhase: Record<string, number>;
  reflectionsOutsideRun: number;
  turnsWithoutSessionTie: number;
  overOpenRun: {
    withObserve: number;
    withoutObserve: number;
    cases: OverOpenRunCase[];
  };
}

export interface ReportInputs {
  events: ReportedEvent[];
  replyModes: Map<string, string | null>;
  nodeTitle: (node: string) => string | null;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;

  return counts;
}

function ofChange(events: ReportedEvent[], change: RunEvent["change"]): ReportedEvent[] {
  return events.filter((e) => e.change === change);
}

function sawEveryPhase(run: RunRecord): boolean {
  return PHASES.every((phase) => run.phases.includes(phase));
}

function finishedInItsTurn(turn: ReportedEvent, finished: ReportedEvent[]): boolean {
  return finished.some((f) => f.turn === turn.turn);
}

function overOpenRunCase(
  turn: ReportedEvent,
  inputs: ReportInputs,
  superseded: ReportedEvent[],
  runs: Record<string, RunRecord>
): OverOpenRunCase {
  const oldRunId = superseded.find((s) => s.turn === turn.turn)?.run;
  const oldRun = oldRunId ? runs[oldRunId] : undefined;

  return {
    date: turn.ts.slice(0, 10),
    project: turn.project ?? null,
    node: turn.node,
    nodeTitle: turn.node ? inputs.nodeTitle(turn.node) : null,
    oldPhases: oldRun?.phases ?? [],
    observe: turn.startsNew === true,
    oldTurn: oldRun?.startTurn ?? null,
    newTurn: turn.turn,
  };
}

function reflectionsOutsideRun(events: ReportedEvent[]): number {
  const settled = new Set(
    events
      .filter((e) => e.change === "turn" || e.change === "finished")
      .map((e) => e.turn)
  );

  return ofChange(events, "reflected").filter((e) => !settled.has(e.turn)).length;
}

function share(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

export function algorithmRunReport(inputs: ReportInputs): AlgorithmRunReport {
  const { events, replyModes } = inputs;
  const turns = ofChange(events, "turn");
  const finished = ofChange(events, "finished");
  const superseded = ofChange(events, "superseded");
  const runs = replayRuns(events).runs;
  const started = turns.flatMap((t) => (t.run ? [runs[t.run] as RunRecord] : []));
  const outcomes = countBy(started, (run) => run.outcome);
  const verdicts = countBy(turns, (t) => t.verdict ?? "unknown");
  const overOpen = turns.filter((t) => t.verdict === "over-open-run");
  const cases = overOpen.map((t) => overOpenRunCase(t, inputs, superseded, runs));

  return {
    algorithmTurns: turns.length,
    taggedByReplyMode: turns.filter(
      (t) => t.turn && replyModes.get(t.turn) === "ALGORITHM"
    ).length,
    runs: {
      started: started.length,
      finished: outcomes.finished ?? 0,
      superseded: outcomes.superseded ?? 0,
      open: outcomes.open ?? 0,
    },
    finishedWithAllPhases: started.filter(
      (r) => r.outcome === "finished" && sawEveryPhase(r)
    ).length,
    verdicts,
    noNodeShare: share(verdicts["no-node"] ?? 0, turns.length),
    unreflectedByLastPhase: countBy(
      turns.filter((t) => !finishedInItsTurn(t, finished)),
      (t) => lastPhase(t.phases ?? []) ?? "none"
    ),
    reflectionsOutsideRun: reflectionsOutsideRun(events),
    turnsWithoutSessionTie: turns.filter((t) => !shellKnowsSession(String(t.runtime)))
      .length,
    overOpenRun: {
      withObserve: cases.filter((c) => c.observe).length,
      withoutObserve: cases.filter((c) => !c.observe).length,
      cases,
    },
  };
}
