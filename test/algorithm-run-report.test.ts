import { describe, expect, spyOn, test } from "bun:test";
import { appendEvent } from "../src/bronze/events";
import { algorithmRunCommand, formatReport, reportSince } from "../src/cli/algorithm-run";
import {
  algorithmRunReport,
  type ReportedEvent,
} from "../src/progress/algorithm-run-report";
import { runCommand } from "../src/tools/lib/command";
import { enterNode, inSandbox, makeSandbox } from "./lib/algorithm-run-fixture";
import { freshTestDir } from "./lib/test-home";

const T = (day: number) => `2026-11-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const ALL = ["OBSERVE", "PLAN", "EXECUTE", "VERIFY", "LEARN"];

function turn(
  run: string,
  node: string | null,
  turnId: string,
  day: number,
  extra: Partial<ReportedEvent> = {}
): ReportedEvent {
  return {
    id: run,
    ts: T(day),
    change: "turn",
    run,
    node,
    turn: turnId,
    phases: ["OBSERVE"],
    verdict: node ? "started" : "no-node",
    startsNew: true,
    runtime: "claude",
    project: "proj-a",
    ...extra,
  };
}

function event(
  change: ReportedEvent["change"],
  run: string | null,
  node: string | null,
  turnId: string,
  day: number,
  phases?: string[]
): ReportedEvent {
  return {
    id: `${change}-${turnId}-${run}`,
    ts: T(day),
    change,
    run,
    node,
    turn: turnId,
    ...(phases && { phases }),
  };
}

const FIXTURE: ReportedEvent[] = [
  turn("r1", "n1", "t1", 1, { phases: ALL }),
  event("finished", "r1", "n1", "t1", 1),
  event("reflected", null, "n1", "t2", 2),
  turn("r2", "n1", "t2", 2, { phases: ["OBSERVE", "PLAN", "EXECUTE"] }),
  event("superseded", "r2", "n1", "t3", 3),
  turn("r3", "n1", "t3", 3, { verdict: "over-open-run", phases: ["OBSERVE", "PLAN"] }),
  event("superseded", "r3", "n1", "t4", 4),
  turn("r4", "n1", "t4", 4, {
    verdict: "over-open-run",
    startsNew: false,
    phases: ["VERIFY"],
    runtime: "vscode",
  }),
  turn("r5", null, "t5", 5, { phases: ALL }),
  event("reflected", null, "n2", "t6", 6),
  event("reflected", null, "n2", "t8", 6),
  event("reflected", null, "n2", "t10", 6),
  event("reflected", null, "n1", "t7", 7),
  event("finished", "r4", "n1", "t7", 7, ["LEARN"]),
];

function report() {
  return algorithmRunReport({
    events: FIXTURE,
    replyModes: new Map([
      ["t1", "ALGORITHM"],
      ["t2", null],
      ["t3", "NATIVE"],
    ]),
    nodeTitle: (node) => (node === "n1" ? "the node" : null),
  });
}

describe("the report's counts", () => {
  test("turns, runs and how they ended", () => {
    const r = report();
    expect(r.algorithmTurns).toBe(5);
    expect(r.taggedByReplyMode).toBe(1);
    expect(r.runs).toEqual({ started: 5, finished: 2, superseded: 2, open: 1 });
    expect(r.finishedWithAllPhases).toBe(1);
  });

  test("verdicts and the share of no-node", () => {
    const r = report();
    expect(r.verdicts).toEqual({ started: 2, "over-open-run": 2, "no-node": 1 });
    expect(r.noNodeShare).toBe(0.2);
  });

  test("turns without a reflection, by the last phase they reached", () => {
    expect(report().unreflectedByLastPhase).toEqual({
      EXECUTE: 1,
      PLAN: 1,
      VERIFY: 1,
      LEARN: 1,
    });
  });

  test("an open run with all five phases is not a finished one", () => {
    expect(report().finishedWithAllPhases).toBe(1);
    const openOnly = algorithmRunReport({
      events: [turn("r1", "n1", "t1", 1, { phases: ALL })],
      replyModes: new Map(),
      nodeTitle: () => null,
    });
    expect(openOnly.finishedWithAllPhases).toBe(0);
  });

  test("reflections outside a run, and turns no reflection can be tied to", () => {
    const r = report();
    expect(r.reflectionsOutsideRun).toBe(3);
    expect(r.turnsWithoutSessionTie).toBe(1);
  });

  test("every over-open-run case, split by OBSERVE written", () => {
    const { overOpenRun } = report();
    expect(overOpenRun.withObserve).toBe(1);
    expect(overOpenRun.withoutObserve).toBe(1);
    expect(overOpenRun.cases).toEqual([
      {
        date: "2026-11-03",
        project: "proj-a",
        node: "n1",
        nodeTitle: "the node",
        oldPhases: ["OBSERVE", "PLAN", "EXECUTE"],
        observe: true,
        oldTurn: "t2",
        newTurn: "t3",
      },
      {
        date: "2026-11-04",
        project: "proj-a",
        node: "n1",
        nodeTitle: "the node",
        oldPhases: ["OBSERVE", "PLAN"],
        observe: false,
        oldTurn: "t3",
        newTurn: "t4",
      },
    ]);
  });

  test("an empty log", () => {
    const r = algorithmRunReport({
      events: [],
      replyModes: new Map(),
      nodeTitle: () => null,
    });
    expect(r.noNodeShare).toBeNull();
    expect(r.runs).toEqual({ started: 0, finished: 0, superseded: 0, open: 0 });
    expect(formatReport(r)).toContain("Turns by verdict: none (no-node -)");
  });

  test("a case with no node, project, old run or turn, and a turn with no run or verdict", () => {
    const r = algorithmRunReport({
      events: [
        {
          ...turn("r9", null, "t9", 9, { verdict: "over-open-run" }),
          turn: null,
          project: undefined,
          runtime: undefined,
        },
        { id: "x", ts: T(9), change: "turn", run: null, node: null, turn: "t10" },
      ],
      replyModes: new Map(),
      nodeTitle: () => "never asked",
    });
    expect(r.overOpenRun.cases[0]).toMatchObject({
      project: null,
      nodeTitle: null,
      oldPhases: [],
      oldTurn: null,
      newTurn: null,
    });
    expect(r.overOpenRun.withObserve).toBe(1);
    expect(r.overOpenRun.withoutObserve).toBe(0);
    expect(r.verdicts).toEqual({ "over-open-run": 1, unknown: 1 });
    expect(r.runs.started).toBe(1);
    expect(r.unreflectedByLastPhase).toEqual({ OBSERVE: 1, none: 1 });
    expect(r.turnsWithoutSessionTie).toBe(2);
    expect(formatReport(r).at(-1)).toBe(
      '  2026-11-09 - "-" old [] observe yes turns - -> -'
    );
  });
});

describe("the printed report", () => {
  test("one line per count, then one per case", () => {
    expect(formatReport(report())).toEqual([
      "ALGORITHM turns: 5 (reply.mode tagged 1)",
      "Runs started: 5 (finished 2, superseded 2, open 1)",
      "Finished runs with all five phases: 1",
      "Turns by verdict: started 2, over-open-run 2, no-node 1 (no-node 20%)",
      "ALGORITHM turns without a reflection, by last phase: EXECUTE 1, PLAN 1, VERIFY 1, LEARN 1",
      "Reflections outside a run: 3",
      "Turns from agents that cannot tie a reflection to a turn: 1",
      "over-open-run: 2 (OBSERVE written 1, not 1)",
      '  2026-11-03 proj-a "the node" old [OBSERVE PLAN EXECUTE] observe yes turns t2 -> t3',
      '  2026-11-04 proj-a "the node" old [OBSERVE PLAN] observe no turns t3 -> t4',
    ]);
  });
});

describe("pal cli algorithm-run report", () => {
  async function runReport(args: string[]): Promise<{ code: number; out: string[] }> {
    const out: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...a) => {
      out.push(a.join(" "));
    });

    try {
      const code = await runCommand(
        algorithmRunCommand,
        ["report", ...args],
        ["pal", "cli", "algorithm-run"]
      );

      return { code, out };
    } finally {
      log.mockRestore();
    }
  }

  test("reads the log, the reply modes and the node titles", async () => {
    const box = makeSandbox(freshTestDir(import.meta.file));
    await inSandbox(box, async () => {
      enterNode(box, "n1", "s1");
      appendEvent("reply", { mode: "ALGORITHM", turn: "t1" }, { ts: T(1) });
      appendEvent("reply", { mode: "NATIVE" }, { ts: T(1) });
      appendEvent(
        "algorithm_run",
        { change: "turn", run: "r1", node: "n1", turn: "t1", verdict: "started" },
        { id: "r1", ts: T(1) }
      );
      appendEvent(
        "algorithm_run",
        { change: "superseded", run: "r1", node: "n1", turn: "t2" },
        { ts: T(2) }
      );
      appendEvent(
        "algorithm_run",
        { change: "turn", run: "r2", node: "n1", turn: "t2", verdict: "over-open-run" },
        { id: "r2", ts: T(2) }
      );
      expect(reportSince(new Date(T(2))).algorithmTurns).toBe(1);
      const text = await runReport([]);
      expect(text.code).toBe(0);
      expect(text.out[0]).toBe("ALGORITHM turns: 2 (reply.mode tagged 1)");
      expect(text.out.at(-1)).toContain('"title n1"');
      const json = await runReport(["--json", "--since", "2026-11-02"]);
      expect(JSON.parse(json.out.join("\n")).algorithmTurns).toBe(1);
    });
  });

  test("a bad --since is a usage error", async () => {
    const err = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect((await runReport(["--since", "not-a-date"])).code).toBe(1);
      expect(err.mock.calls.flat().join(" ")).toContain(
        '--since must be a date such as 2026-11-15, got "not-a-date"'
      );
    } finally {
      err.mockRestore();
    }
  });
});
