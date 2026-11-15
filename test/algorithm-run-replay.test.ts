import { describe, expect, test } from "bun:test";
import type { AlgorithmTurnFacts } from "../src/progress/algorithm-run-facts";
import {
  cachedState,
  emptyRunState,
  type RunEvent,
  replayRuns,
  type StopTurn,
  stopEvents,
} from "../src/progress/algorithm-run-replay";

const T = (minute: number) => `2026-11-15T10:${String(minute).padStart(2, "0")}:00.000Z`;

function started(
  run: string,
  node: string | null,
  turn: string,
  minute: number,
  phases: string[] = ["OBSERVE"]
): RunEvent {
  return { id: run, ts: T(minute), change: "turn", run, node, turn, phases };
}

function closed(
  change: "finished" | "superseded",
  run: string,
  node: string | null,
  turn: string,
  minute: number,
  phases?: string[]
): RunEvent {
  return {
    id: `${change}-${run}`,
    ts: T(minute),
    change,
    run,
    node,
    turn,
    ...(phases && { phases }),
  };
}

function reflected(node: string | null, turn: string, minute: number): RunEvent {
  return { id: `reflected-${turn}`, ts: T(minute), change: "reflected", node, turn };
}

const FACTS: AlgorithmTurnFacts = {
  header: "pal",
  headerFirst: true,
  phases: ["OBSERVE", "PLAN", "EXECUTE"],
  startsNew: true,
};

function stop(overrides: Partial<StopTurn>): StopTurn {
  return {
    facts: FACTS,
    phases: FACTS.phases,
    node: "n1",
    turn: "t2",
    reflected: false,
    open: undefined,
    newRun: "run-2",
    source: "transcript",
    ...overrides,
  };
}

describe("replaying runs", () => {
  test("started then finished leaves no open run", () => {
    const replay = replayRuns([
      started("r1", "n1", "t1", 0),
      closed("finished", "r1", "n1", "t1", 0),
    ]);
    expect(replay.open).toEqual({});
    expect(replay.runs.r1).toEqual({
      run: "r1",
      node: "n1",
      startedAt: T(0),
      startTurn: "t1",
      phases: ["OBSERVE"],
      outcome: "finished",
    });
  });

  test("an interrupted run is superseded by the next ALGORITHM turn on its node", () => {
    const replay = replayRuns([
      started("r1", "n1", "t1", 0, ["OBSERVE", "PLAN"]),
      closed("superseded", "r1", "n1", "t2", 5),
      started("r2", "n1", "t2", 5, ["EXECUTE"]),
    ]);
    expect(replay.runs.r1?.outcome).toBe("superseded");
    expect(replay.open).toEqual({
      n1: { run: "r2", node: "n1", startedAt: T(5), phases: ["EXECUTE"] },
    });
  });

  test("a finish in a later turn adds that turn's phases to the run", () => {
    const replay = replayRuns([
      started("r1", "n1", "t1", 0, ["OBSERVE", "PLAN"]),
      closed("finished", "r1", "n1", "t3", 9, ["PLAN", "VERIFY", "LEARN"]),
    ]);
    expect(replay.runs.r1?.phases).toEqual(["OBSERVE", "PLAN", "VERIFY", "LEARN"]);
    expect(replay.open).toEqual({});
  });

  test("two nodes do not affect each other", () => {
    const replay = replayRuns([
      started("r1", "n1", "t1", 0),
      started("r2", "n2", "t2", 1),
      closed("finished", "r2", "n2", "t2", 1),
    ]);
    expect(Object.keys(replay.open)).toEqual(["n1"]);
    expect(replay.runs.r1?.outcome).toBe("open");
  });

  test("a turn that names no phases opens a run with none", () => {
    const { phases: _phases, ...bare } = started("r1", "n1", "t1", 0);
    expect(replayRuns([bare]).open.n1?.phases).toEqual([]);
  });

  test("a run with no node is started but never held open", () => {
    const replay = replayRuns([started("r1", null, "t1", 0)]);
    expect(replay.open).toEqual({});
    expect(replay.runs.r1?.outcome).toBe("open");
  });

  test("a reflection waits for its turn's stop, which settles it", () => {
    const waiting = replayRuns([reflected("n1", "t1", 0)]);
    expect(waiting.pending).toEqual({ t1: { turn: "t1", node: "n1", at: T(0) } });
    expect(replayRuns([started("r1", "n1", "t1", 1)], waiting).pending).toEqual({});
    expect(
      replayRuns([closed("finished", "r1", "n1", "t1", 1)], waiting).pending
    ).toEqual({});
  });

  test("a reflection without a turn waits for nothing", () => {
    expect(replayRuns([{ ...reflected("n1", "t1", 0), turn: null }]).pending).toEqual({});
  });

  test("events without a run change nothing", () => {
    const replay = replayRuns([{ ...started("r1", "n1", "t1", 0), run: null }]);
    expect(replay).toEqual({ open: {}, pending: {}, runs: {} });
  });

  test("continues from a cached state without changing it", () => {
    const cached = replayRuns([started("r1", "n1", "t1", 0)]);
    const before = structuredClone({ open: cached.open, pending: cached.pending });
    const next = replayRuns([closed("finished", "r1", "n1", "t2", 3)], cached);
    expect(next.open).toEqual({});
    expect({ open: cached.open, pending: cached.pending }).toEqual(before);
  });
});

describe("what the cache keeps", () => {
  test("open runs, and reflections younger than a day", () => {
    const state = replayRuns([
      started("r1", "n1", "t1", 0),
      { ...reflected("n1", "old", 0), ts: "2026-11-14T10:00:00.000Z" },
      { ...reflected("n1", "edge", 0), ts: "2026-11-14T10:30:00.000Z" },
      reflected("n1", "new", 30),
    ]);
    const kept = cachedState(state, new Date("2026-11-15T10:30:00.000Z"));
    expect(kept.open).toEqual(state.open);
    expect(Object.keys(kept.pending)).toEqual(["edge", "new"]);
    expect(Object.keys(kept)).toEqual(["open", "pending"]);
  });

  test("an empty state", () => {
    expect(emptyRunState()).toEqual({ open: {}, pending: {} });
  });
});

describe("the events a stop appends", () => {
  const open = { run: "run-1", node: "n1", startedAt: T(0), phases: ["OBSERVE"] };

  test("an ALGORITHM turn on a node without an open run starts one", () => {
    expect(stopEvents(stop({}))).toEqual([
      {
        id: "run-2",
        fields: {
          change: "turn",
          run: "run-2",
          node: "n1",
          turn: "t2",
          ...FACTS,
          verdict: "started",
          source: "transcript",
          mode: "shadow",
        },
      },
    ]);
  });

  test("over an open run: superseded for the old run, then the new turn", () => {
    const events = stopEvents(stop({ open, source: "final-reply" }));
    expect(events.map((e) => e.fields.change)).toEqual(["superseded", "turn"]);
    expect(events[0]).toEqual({
      fields: {
        change: "superseded",
        run: "run-1",
        node: "n1",
        turn: "t2",
        mode: "shadow",
      },
    });
    expect(events[1]?.fields).toMatchObject({
      verdict: "over-open-run",
      source: "final-reply",
    });
  });

  test("a reflected ALGORITHM turn over an open run: superseded, turn, finished for the new run", () => {
    const events = stopEvents(stop({ open, reflected: true }));
    expect(events.map((e) => e.fields.change)).toEqual([
      "superseded",
      "turn",
      "finished",
    ]);
    expect(events[2]).toEqual({
      fields: {
        change: "finished",
        run: "run-2",
        node: "n1",
        turn: "t2",
        mode: "shadow",
      },
    });
  });

  test("no node: no-node, and an open run elsewhere is not superseded", () => {
    const events = stopEvents(stop({ node: null, open }));
    expect(events.map((e) => e.fields.change)).toEqual(["turn"]);
    expect(events[0]?.fields).toMatchObject({ verdict: "no-node", node: null });
  });

  test("a reflected turn in another mode finishes the open run, with its phases", () => {
    expect(
      stopEvents(
        stop({ facts: null, phases: ["VERIFY", "LEARN"], reflected: true, open })
      )
    ).toEqual([
      {
        fields: {
          change: "finished",
          run: "run-1",
          node: "n1",
          turn: "t2",
          phases: ["VERIFY", "LEARN"],
          mode: "shadow",
        },
      },
    ]);
  });

  test("a turn in another mode: nothing without a reflection or without an open run", () => {
    expect(stopEvents(stop({ facts: null, open }))).toEqual([]);
    expect(stopEvents(stop({ facts: null, reflected: true }))).toEqual([]);
  });
});
