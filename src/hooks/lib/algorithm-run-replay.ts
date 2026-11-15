/**
 * ALGORITHM runs as a fold over their algorithm_run events, and the events one
 * stop adds. Pure: the cache, the stop and the report all fold the same way.
 */

import { type AlgorithmTurnFacts, runVerdict } from "./algorithm-run-facts";

type RunChange = "turn" | "reflected" | "finished" | "superseded";

type RunOutcome = "open" | "finished" | "superseded";

export interface RunEvent {
  id: string;
  ts: string;
  change: RunChange;
  run?: string | null;
  node: string | null;
  turn: string | null;
  phases?: string[];
}

interface OpenRun {
  run: string;
  node: string;
  startedAt: string;
  phases: string[];
}

interface PendingReflection {
  turn: string;
  node: string | null;
  at: string;
}

export interface RunState {
  open: Record<string, OpenRun>;
  pending: Record<string, PendingReflection>;
}

export interface RunRecord {
  run: string;
  node: string | null;
  startedAt: string;
  startTurn: string | null;
  phases: string[];
  outcome: RunOutcome;
}

export interface Replay extends RunState {
  runs: Record<string, RunRecord>;
}

const PENDING_KEPT_MS = 24 * 60 * 60 * 1000;

export function emptyRunState(): RunState {
  return { open: {}, pending: {} };
}

function union(a: readonly string[], b: readonly string[] = []): string[] {
  return [...new Set([...a, ...b])];
}

function openRun(replay: Replay, event: RunEvent, run: string): void {
  const phases = event.phases ?? [];
  replay.runs[run] = {
    run,
    node: event.node,
    startedAt: event.ts,
    startTurn: event.turn,
    phases,
    outcome: "open",
  };

  if (event.node)
    replay.open[event.node] = { run, node: event.node, startedAt: event.ts, phases };
}

function closeRun(
  replay: Replay,
  event: RunEvent,
  run: string,
  outcome: RunOutcome
): void {
  const record = replay.runs[run];
  if (record)
    replay.runs[run] = { ...record, outcome, phases: union(record.phases, event.phases) };

  for (const [node, open] of Object.entries(replay.open)) {
    if (open.run === run) delete replay.open[node];
  }
}

function settleTurn(replay: Replay, turn: string | null): void {
  delete replay.pending[String(turn)];
}

function apply(replay: Replay, event: RunEvent): void {
  const run = event.run;

  if (event.change === "reflected") {
    if (event.turn)
      replay.pending[event.turn] = { turn: event.turn, node: event.node, at: event.ts };

    return;
  }

  if (!run) return;

  if (event.change === "turn") openRun(replay, event, run);
  else closeRun(replay, event, run, event.change);

  settleTurn(replay, event.turn);
}

export function replayRuns(
  events: readonly RunEvent[],
  from: RunState = emptyRunState()
): Replay {
  const replay: Replay = {
    open: { ...from.open },
    pending: { ...from.pending },
    runs: {},
  };

  for (const event of events) apply(replay, event);

  return replay;
}

/** What the cache keeps: open runs, and reflections younger than a day still waiting for their stop. */
export function cachedState(state: RunState, now: Date): RunState {
  const keptFrom = new Date(now.getTime() - PENDING_KEPT_MS).toISOString();
  const pending = Object.entries(state.pending).filter(([, p]) => p.at >= keptFrom);

  return { open: state.open, pending: Object.fromEntries(pending) };
}

export interface StopTurn {
  facts: AlgorithmTurnFacts | null;
  phases: string[];
  node: string | null;
  turn: string | null;
  reflected: boolean;
  open: OpenRun | undefined;
  newRun: string;
  source: "transcript" | "final-reply";
}

export interface PlannedEvent {
  id?: string;
  fields: Record<string, unknown> & { change: RunChange };
}

function shadow(fields: PlannedEvent["fields"]): PlannedEvent["fields"] {
  return { ...fields, mode: "shadow" };
}

function algorithmTurnEvents(stop: StopTurn, facts: AlgorithmTurnFacts): PlannedEvent[] {
  const { node, turn, open, newRun } = stop;
  const verdict = runVerdict(node, open);
  const superseded: PlannedEvent[] =
    open && verdict === "over-open-run"
      ? [{ fields: shadow({ change: "superseded", run: open.run, node, turn }) }]
      : [];
  const started: PlannedEvent = {
    id: newRun,
    fields: shadow({
      change: "turn",
      run: newRun,
      node,
      turn,
      ...facts,
      verdict,
      source: stop.source,
    }),
  };
  const finished: PlannedEvent[] = stop.reflected
    ? [{ fields: shadow({ change: "finished", run: newRun, node, turn }) }]
    : [];

  return [...superseded, started, ...finished];
}

/** The events a stop appends for the turn it records; none for a turn that touched no run. */
export function stopEvents(stop: StopTurn): PlannedEvent[] {
  if (stop.facts) return algorithmTurnEvents(stop, stop.facts);

  if (!stop.reflected || !stop.open) return [];

  return [
    {
      fields: shadow({
        change: "finished",
        run: stop.open.run,
        node: stop.node,
        turn: stop.turn,
        phases: stop.phases,
      }),
    },
  ];
}
