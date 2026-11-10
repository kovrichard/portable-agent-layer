import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as build from "../assets/plugins/dark-factory/scripts/build.mjs";
import * as libModule from "../assets/plugins/dark-factory/scripts/lib.mjs";
import {
  appendEvent,
  readEvents,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import * as statsModule from "../assets/plugins/dark-factory/scripts/stats.mjs";
import { summarize } from "../assets/plugins/dark-factory/scripts/stats.mjs";
import {
  markStarted,
  setStatus,
  showTask,
} from "../assets/plugins/dark-factory/scripts/task.mjs";
import { buildWorld, eventsNamed } from "./lib/dark-factory-build-fixture";
import {
  type FactoryEnv,
  freshFactoryHome,
  PLUGIN_ROOT,
} from "./lib/dark-factory-scripts-fixture";

let env: FactoryEnv;
let clock: number;

beforeEach(() => {
  ({ env } = freshFactoryHome(import.meta.file));
  clock = Date.parse("2026-01-01T00:00:00Z");
});

const tick = () => {
  clock += 1000;
  return new Date(clock);
};

type Past = {
  category?: string;
  status?: string;
  wallMs?: number | null;
  tokens?: number | null;
  costUsd?: number | null;
};

let counter = 0;
function pastRun(past: Past) {
  const task = `old-${counter++}`;
  appendEvent(
    { event: "task_started", task, category: past.category ?? "bug" },
    env,
    tick()
  );
  appendEvent(
    {
      event: "run_finished",
      task,
      status: past.status ?? "ready",
      wallMs: past.wallMs ?? null,
      tokens: past.tokens ?? null,
      costUsd: past.costUsd ?? null,
      roleRuns: 1,
    },
    env,
    tick()
  );
}

function newOne(id = "new-1", category = "bug") {
  writeTask({ id, title: id, repo: "/repo", category, status: "draft" }, env);
  return id;
}

const ofTask = (id: string, name: string) =>
  readEvents(env).filter(
    (event: { event: string; task?: string }) => event.event === name && event.task === id
  );

describe("the estimate written at the start (criteria 1-3)", () => {
  test("holds the medians of the ready runs of the same category, with their count", () => {
    pastRun({ wallMs: 10, tokens: 100, costUsd: 1 });
    pastRun({ wallMs: 30, tokens: 300, costUsd: 3 });
    pastRun({ wallMs: 20, tokens: 200, costUsd: 2 });
    pastRun({ category: "feature", wallMs: 9999, tokens: 9999, costUsd: 99 });
    const id = newOne();
    markStarted(id, env);
    expect(ofTask(id, "estimate")).toEqual([
      expect.objectContaining({
        event: "estimate",
        task: id,
        category: "bug",
        wallMs: 20,
        tokens: 200,
        costUsd: 2,
        basis: 3,
      }),
    ]);
  });

  test("the estimate comes right after task_started", () => {
    pastRun({ wallMs: 10, tokens: 100, costUsd: 1 });
    const id = newOne();
    markStarted(id, env);
    const mine = readEvents(env).filter((event: { task?: string }) => event.task === id);
    expect(mine.map((event: { event: string }) => event.event)).toEqual([
      "task_started",
      "estimate",
    ]);
  });

  test("stuck and waiting runs are not history", () => {
    pastRun({ wallMs: 10, tokens: 100, costUsd: 1 });
    pastRun({ status: "stuck", wallMs: 5000, tokens: 5000, costUsd: 50 });
    pastRun({ status: "waiting", wallMs: 5000, tokens: 5000, costUsd: 50 });
    const id = newOne();
    markStarted(id, env);
    expect(ofTask(id, "estimate")[0]).toMatchObject({
      wallMs: 10,
      tokens: 100,
      costUsd: 1,
      basis: 1,
    });
  });

  test("only the last 10 ready runs count", () => {
    pastRun({ wallMs: 1e9, tokens: 1e9, costUsd: 1e9 });
    pastRun({ wallMs: 1e9, tokens: 1e9, costUsd: 1e9 });
    for (let i = 0; i < 10; i++) pastRun({ wallMs: 100, tokens: 50, costUsd: 2 });
    const id = newOne();
    markStarted(id, env);
    expect(ofTask(id, "estimate")[0]).toMatchObject({
      wallMs: 100,
      tokens: 50,
      costUsd: 2,
      basis: 10,
    });
  });

  test("a resumed run gets its own estimate", () => {
    pastRun({ wallMs: 10, tokens: 100, costUsd: 1 });
    const id = newOne();
    markStarted(id, env);
    setStatus(id, "stuck", "red", env);
    markStarted(id, env);
    expect(ofTask(id, "estimate")).toHaveLength(2);
    expect(ofTask(id, "task_started")).toHaveLength(2);
  });

  test("the cost median uses only runs whose cost is a number", () => {
    pastRun({ wallMs: 10, tokens: 100, costUsd: 1 });
    pastRun({ wallMs: 20, tokens: 200, costUsd: null });
    pastRun({ wallMs: 30, tokens: 300, costUsd: 3 });
    const id = newOne();
    markStarted(id, env);
    expect(ofTask(id, "estimate")[0]).toMatchObject({
      wallMs: 20,
      tokens: 200,
      costUsd: 2,
      basis: 3,
    });
  });

  test("the cost is null when no run has a cost", () => {
    pastRun({ wallMs: 10, tokens: 100, costUsd: null });
    pastRun({ wallMs: 30, tokens: 300, costUsd: null });
    const id = newOne();
    markStarted(id, env);
    expect(ofTask(id, "estimate")[0]).toMatchObject({
      wallMs: 20,
      tokens: 200,
      costUsd: null,
      basis: 2,
    });
  });

  test("with no history the estimate is all null with basis 0", () => {
    const id = newOne();
    markStarted(id, env);
    expect(ofTask(id, "estimate")).toEqual([
      expect.objectContaining({
        task: id,
        category: "bug",
        wallMs: null,
        tokens: null,
        costUsd: null,
        basis: 0,
      }),
    ]);
  });

  test("history of another category only gives basis 0", () => {
    pastRun({ category: "feature", wallMs: 10, tokens: 100, costUsd: 1 });
    const id = newOne();
    markStarted(id, env);
    expect(ofTask(id, "estimate")[0]).toMatchObject({ wallMs: null, basis: 0 });
  });
});

describe("one run_finished per run, at the final status (criteria 4-5)", () => {
  function startedLongAgo(id: string, msAgo: number) {
    appendEvent(
      { event: "task_started", task: id, category: "bug" },
      env,
      new Date(Date.now() - msAgo)
    );
  }

  test.each(["ready", "stuck", "waiting"])("%s writes run_finished once", (status) => {
    const id = newOne();
    markStarted(id, env);
    setStatus(id, status, "n", env);
    expect(ofTask(id, "run_finished")).toEqual([
      expect.objectContaining({ task: id, status }),
    ]);
  });

  test("a second final status in the same run appends nothing", () => {
    const id = newOne();
    markStarted(id, env);
    setStatus(id, "ready", undefined, env);
    const before = readEvents(env).filter(
      (event: { event: string }) => event.event === "run_finished"
    );
    setStatus(id, "ready", undefined, env);
    setStatus(id, "stuck", "later", env);
    const after = readEvents(env).filter(
      (event: { event: string }) => event.event === "run_finished"
    );
    expect(before).toHaveLength(1);
    expect(after).toEqual(before);
  });

  test("running never writes run_finished", () => {
    const id = newOne();
    markStarted(id, env);
    setStatus(id, "running", "go", env);
    expect(ofTask(id, "run_finished")).toHaveLength(0);
  });

  test("a status with no started run writes no run_finished", () => {
    const id = newOne();
    setStatus(id, "stuck", "x", env);
    expect(ofTask(id, "run_finished")).toHaveLength(0);
  });

  test("a resumed run finishes on its own", () => {
    const id = newOne();
    markStarted(id, env);
    setStatus(id, "stuck", "red", env);
    markStarted(id, env);
    setStatus(id, "ready", undefined, env);
    expect(ofTask(id, "run_finished")).toHaveLength(2);
  });

  test("wallMs is the time since task_started, and totals come from that run only", () => {
    const id = newOne();
    appendEvent(
      { event: "role_finished", task: id, role: "old", costUsd: 100, inputTokens: 1000 },
      env,
      new Date(Date.now() - 3_700_000)
    );
    startedLongAgo(id, 60_000);
    appendEvent(
      {
        event: "role_finished",
        task: id,
        role: "coder",
        costUsd: 0.5,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheCreationTokens: 40,
      },
      env
    );
    setStatus(id, "ready", undefined, env);
    const [finished] = ofTask(id, "run_finished");
    expect(finished).toMatchObject({ costUsd: 0.5, tokens: 100, roleRuns: 1 });
    expect(finished.wallMs).toBeGreaterThanOrEqual(60_000);
    expect(finished.wallMs).toBeLessThan(120_000);
  });

  test("costUsd is null when no role_finished carries a numeric cost (B-shaped events)", () => {
    const id = newOne();
    markStarted(id, env);
    appendEvent(
      { event: "role_finished", task: id, role: "a", inputTokens: 5, outputTokens: 7 },
      env
    );
    appendEvent(
      { event: "role_finished", task: id, role: "b", inputTokens: 3, outputTokens: 1 },
      env
    );
    setStatus(id, "ready", undefined, env);
    expect(ofTask(id, "run_finished")[0]).toMatchObject({
      costUsd: null,
      tokens: 16,
      roleRuns: 2,
    });
  });

  test("setStatus still returns the task and task_status is unchanged", () => {
    const id = newOne();
    markStarted(id, env);
    const task = setStatus(id, "ready", "done", env);
    expect(task).toMatchObject({ id, status: "ready", note: "done" });
    expect(Object.keys(ofTask(id, "task_status")[0]).sort()).toEqual(
      ["event", "note", "status", "task", "ts"].sort()
    );
  });

  test("a whole build.mjs run leaves exactly one run_finished and one estimate", () => {
    const world = buildWorld(import.meta.file, { category: "feature" });
    const outcome = build.runBuild("t1", { env: world.env, effects: world.effects });
    expect(outcome.status).toBe("ready");
    expect(eventsNamed(world, "run_finished")).toHaveLength(1);
    expect(eventsNamed(world, "estimate")).toHaveLength(1);
    expect(eventsNamed(world, "run_finished")[0]).toMatchObject({
      status: "ready",
      costUsd: 1.75,
      tokens: 945,
    });
  });
});

describe("task show (criterion 6)", () => {
  test("includes the latest estimate event of the task", () => {
    pastRun({ wallMs: 10, tokens: 100, costUsd: 1 });
    const id = newOne();
    markStarted(id, env);
    setStatus(id, "stuck", "x", env);
    pastRun({ wallMs: 30, tokens: 300, costUsd: 3 });
    markStarted(id, env);
    const shown = showTask(id, env) as { estimate: Record<string, unknown> | null };
    expect(shown.estimate).toMatchObject({
      event: "estimate",
      task: id,
      wallMs: 20,
      basis: 2,
    });
  });

  test("is null when the task has no estimate", () => {
    const id = newOne();
    expect((showTask(id, env) as { estimate: unknown }).estimate).toBeNull();
  });
});

describe("stats estimates (criterion 7)", () => {
  function run(
    task: string,
    estimate: Record<string, unknown> | null,
    actual: Record<string, unknown>
  ) {
    const events: Record<string, unknown>[] = [{ event: "task_started", task }];
    if (estimate) events.push({ event: "estimate", task, ...estimate });
    events.push({ event: "run_finished", task, status: "ready", ...actual });
    return events;
  }

  const est = (wallMs: unknown, tokens: unknown, costUsd: unknown, basis = 3) => ({
    wallMs,
    tokens,
    costUsd,
    basis,
  });

  test("the median of actual / estimate per measure", () => {
    const events = [
      ...run("a", est(100, 1000, 1), { wallMs: 200, tokens: 2000, costUsd: 2 }),
      ...run("b", est(100, 1000, 1), { wallMs: 100, tokens: 1000, costUsd: 1 }),
    ];
    expect(summarize(events).estimates).toEqual({
      runs: 2,
      wallRatio: 1.5,
      tokensRatio: 1.5,
      costRatio: 1.5,
    });
  });

  test("a measure is skipped where either side is null or the estimate is 0", () => {
    const events = [
      ...run("a", est(100, 1000, 1), { wallMs: 200, tokens: 2000, costUsd: 4 }),
      ...run("b", est(100, 0, null), { wallMs: 100, tokens: 500, costUsd: 5 }),
      ...run("c", est(100, 1000, 1), { wallMs: 100, tokens: 1000, costUsd: null }),
    ];
    expect(summarize(events).estimates).toMatchObject({
      runs: 3,
      wallRatio: 1,
      tokensRatio: 1.5,
      costRatio: 4,
    });
  });

  test("runs with basis 0, with no estimate, or unfinished do not count", () => {
    const events = [
      ...run("a", est(null, null, null, 0), { wallMs: 999, tokens: 999, costUsd: 9 }),
      ...run("b", null, { wallMs: 999, tokens: 999, costUsd: 9 }),
      { event: "task_started", task: "c" },
      { event: "estimate", task: "c", ...est(1, 1, 1) },
      ...run("d", est(100, 100, 1), { wallMs: 300, tokens: 300, costUsd: 3 }),
    ];
    expect(summarize(events).estimates).toEqual({
      runs: 1,
      wallRatio: 3,
      tokensRatio: 3,
      costRatio: 3,
    });
  });

  test("with no qualifying run the ratios are null", () => {
    expect(summarize([]).estimates).toEqual({
      runs: 0,
      wallRatio: null,
      tokensRatio: null,
      costRatio: null,
    });
  });

  test("existing keys are still there", () => {
    expect(summarize([])).toMatchObject({ tasks: 0, outcomes: {}, reviewRounds: 0 });
  });
});

describe("docs (criterion 8)", () => {
  const line = (file: string) =>
    readFileSync(join(PLUGIN_ROOT, file), "utf8")
      .split("\n")
      .filter((text) => /estimate/i.test(text));

  test.each(["skills/build-with-agents/SKILL.md", "README.md"])(
    "%s says the estimate is recorded at start and the actual at the final status",
    (file) => {
      const found = line(file).filter(
        (text) => /start/i.test(text) && /actual/i.test(text) && /final/i.test(text)
      );
      expect(found.length).toBeGreaterThanOrEqual(1);
    }
  );
});

// Rows of the example tables in plan.md, one test per row. The functions the plan adds
// are reached through namespace objects, so a missing export fails its own test and not
// the whole file.
const libApi = libModule as unknown as {
  runTotals: (events: unknown[], taskId: string, startedIso: string) => unknown;
};
const statsApi = statsModule as unknown as {
  estimateFor: (events: unknown[], category: string) => Record<string, unknown>;
};
const estimatesOf = (events: unknown[]) =>
  (summarize(events) as unknown as { estimates: unknown }).estimates;

// A closed run as the in-memory events runsOf and estimateFor read them.
const done = (
  task: string,
  category: string,
  status: string,
  wallMs: unknown,
  tokens: unknown,
  costUsd: unknown
): unknown[] => [
  { event: "task_started", task, category },
  { event: "run_finished", task, status, wallMs, tokens, costUsd },
];

describe("plan step 1: runTotals rows", () => {
  const START = "2026-10-20T10:00:00.000Z";
  const BEFORE = "2026-10-20T09:00:00.000Z";
  const AFTER = "2026-10-20T11:00:00.000Z";

  test("two role runs with cost, one before the start, one of another task, one gate: costUsd 0.5, tokens 19, roleRuns 2", () => {
    const events = [
      {
        event: "role_finished",
        task: "t1",
        ts: AFTER,
        costUsd: 0.5,
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      },
      {
        event: "role_finished",
        task: "t1",
        ts: AFTER,
        costUsd: null,
        inputTokens: null,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      },
      {
        event: "role_finished",
        task: "t1",
        ts: BEFORE,
        costUsd: 9,
        inputTokens: 100,
        outputTokens: 100,
        cacheReadTokens: 100,
        cacheCreationTokens: 100,
      },
      {
        event: "role_finished",
        task: "t2",
        ts: AFTER,
        costUsd: 9,
        inputTokens: 100,
        outputTokens: 100,
        cacheReadTokens: 100,
        cacheCreationTokens: 100,
      },
      { event: "gate", task: "t1", ts: AFTER, costUsd: 9, inputTokens: 100 },
    ];
    expect(libApi.runTotals(events, "t1", START)).toEqual({
      costUsd: 0.5,
      tokens: 19,
      roleRuns: 2,
    });
  });

  test("two role runs without costUsd: costUsd null, tokens 16, roleRuns 2", () => {
    const events = [
      { event: "role_finished", task: "t1", ts: AFTER, inputTokens: 5, outputTokens: 7 },
      { event: "role_finished", task: "t1", ts: AFTER, inputTokens: 3, outputTokens: 1 },
    ];
    expect(libApi.runTotals(events, "t1", BEFORE)).toEqual({
      costUsd: null,
      tokens: 16,
      roleRuns: 2,
    });
  });

  test("no role_finished: costUsd null, tokens 0, roleRuns 0", () => {
    expect(libApi.runTotals([], "t1", START)).toEqual({
      costUsd: null,
      tokens: 0,
      roleRuns: 0,
    });
  });

  test("one role_finished with costUsd 0 and 10 input tokens: costUsd 0, tokens 10, roleRuns 1", () => {
    const events = [
      { event: "role_finished", task: "t1", ts: AFTER, costUsd: 0, inputTokens: 10 },
    ];
    expect(libApi.runTotals(events, "t1", BEFORE)).toEqual({
      costUsd: 0,
      tokens: 10,
      roleRuns: 1,
    });
  });
});

describe("plan step 3a: median rows, read through estimateFor().wallMs", () => {
  const bugRuns = (walls: unknown[]) =>
    walls.flatMap((wallMs, i) => done(`m${i}`, "bug", "ready", wallMs, 1, 1));

  test("median of no values is null", () => {
    expect(statsApi.estimateFor(bugRuns([]), "bug").wallMs).toBeNull();
  });

  test("median of only null and undefined is null", () => {
    expect(statsApi.estimateFor(bugRuns([null, undefined]), "bug").wallMs).toBeNull();
  });

  test("median of [5] is 5", () => {
    expect(statsApi.estimateFor(bugRuns([5]), "bug").wallMs).toBe(5);
  });

  test("median of [10, 30, 20] is 20", () => {
    expect(statsApi.estimateFor(bugRuns([10, 30, 20]), "bug").wallMs).toBe(20);
  });

  test("median of [1, null, 3] is 2", () => {
    expect(statsApi.estimateFor(bugRuns([1, null, 3]), "bug").wallMs).toBe(2);
  });

  test("median of [2, 1, 1] is 1", () => {
    expect(statsApi.estimateFor(bugRuns([2, 1, 1]), "bug").wallMs).toBe(1);
  });

  test("median of [2, 1] is 1.5", () => {
    expect(statsApi.estimateFor(bugRuns([2, 1]), "bug").wallMs).toBe(1.5);
  });
});

describe("plan step 3b: estimateFor rows", () => {
  test("three bug ready runs and a feature run: wallMs 20, tokens 200, costUsd 2, basis 3", () => {
    const events = [
      ...done("a", "bug", "ready", 10, 100, 1),
      ...done("b", "bug", "ready", 30, 300, 3),
      ...done("c", "bug", "ready", 20, 200, 2),
      ...done("d", "feature", "ready", 9999, 9999, 99),
    ];
    expect(statsApi.estimateFor(events, "bug")).toEqual({
      wallMs: 20,
      tokens: 200,
      costUsd: 2,
      basis: 3,
    });
  });

  test("one bug ready run and a stuck and a waiting bug run: wallMs 10, tokens 100, costUsd 1, basis 1", () => {
    const events = [
      ...done("a", "bug", "ready", 10, 100, 1),
      ...done("b", "bug", "stuck", 5000, 5000, 50),
      ...done("c", "bug", "waiting", 5000, 5000, 50),
    ];
    expect(statsApi.estimateFor(events, "bug")).toEqual({
      wallMs: 10,
      tokens: 100,
      costUsd: 1,
      basis: 1,
    });
  });

  test("two old bug ready runs then ten newer ones: wallMs 100, tokens 50, costUsd 2, basis 10", () => {
    const events = [
      ...done("o1", "bug", "ready", 1e9, 1e9, 1e9),
      ...done("o2", "bug", "ready", 1e9, 1e9, 1e9),
      ...Array.from({ length: 10 }, (_, i) =>
        done(`n${i}`, "bug", "ready", 100, 50, 2)
      ).flat(),
    ];
    expect(statsApi.estimateFor(events, "bug")).toEqual({
      wallMs: 100,
      tokens: 50,
      costUsd: 2,
      basis: 10,
    });
  });

  test("bug ready runs with costs 1, null, 3: wallMs 20, tokens 200, costUsd 2, basis 3", () => {
    const events = [
      ...done("a", "bug", "ready", 10, 100, 1),
      ...done("b", "bug", "ready", 20, 200, null),
      ...done("c", "bug", "ready", 30, 300, 3),
    ];
    expect(statsApi.estimateFor(events, "bug")).toEqual({
      wallMs: 20,
      tokens: 200,
      costUsd: 2,
      basis: 3,
    });
  });

  test("two bug ready runs with null cost: wallMs 20, tokens 200, costUsd null, basis 2", () => {
    const events = [
      ...done("a", "bug", "ready", 10, 100, null),
      ...done("b", "bug", "ready", 30, 300, null),
    ];
    expect(statsApi.estimateFor(events, "bug")).toEqual({
      wallMs: 20,
      tokens: 200,
      costUsd: null,
      basis: 2,
    });
  });

  test("no events: all null with basis 0", () => {
    expect(statsApi.estimateFor([], "bug")).toEqual({
      wallMs: null,
      tokens: null,
      costUsd: null,
      basis: 0,
    });
  });

  test("one feature ready run and category bug: all null with basis 0", () => {
    const events = done("a", "feature", "ready", 10, 100, 1);
    expect(statsApi.estimateFor(events, "bug")).toEqual({
      wallMs: null,
      tokens: null,
      costUsd: null,
      basis: 0,
    });
  });

  test("an unfinished start followed by a second start and a run_finished: wallMs 40, tokens 400, costUsd 4, basis 1", () => {
    const events = [
      { event: "task_started", task: "x", category: "bug" },
      { event: "task_started", task: "x", category: "bug" },
      {
        event: "run_finished",
        task: "x",
        status: "ready",
        wallMs: 40,
        tokens: 400,
        costUsd: 4,
      },
    ];
    expect(statsApi.estimateFor(events, "bug")).toEqual({
      wallMs: 40,
      tokens: 400,
      costUsd: 4,
      basis: 1,
    });
  });

  test("a task that only started (still running): all null with basis 0", () => {
    const events = [{ event: "task_started", task: "x", category: "bug" }];
    expect(statsApi.estimateFor(events, "bug")).toEqual({
      wallMs: null,
      tokens: null,
      costUsd: null,
      basis: 0,
    });
  });
});

describe("plan step 3c: estimateAccuracy rows, read through summarize().estimates", () => {
  const est = (
    task: string,
    wallMs: unknown,
    tokens: unknown,
    costUsd: unknown,
    basis = 1
  ) => [
    { event: "task_started", task },
    { event: "estimate", task, wallMs, tokens, costUsd, basis },
  ];
  const fin = (task: string, wallMs: unknown, tokens: unknown, costUsd: unknown) => [
    { event: "run_finished", task, status: "ready", wallMs, tokens, costUsd },
  ];

  test("two runs, each doubling or matching its estimate: runs 2, ratios 1.5", () => {
    const events = [
      ...est("a", 100, 1000, 1),
      ...fin("a", 200, 2000, 2),
      ...est("b", 100, 1000, 1),
      ...fin("b", 100, 1000, 1),
    ];
    expect(estimatesOf(events)).toEqual({
      runs: 2,
      wallRatio: 1.5,
      tokensRatio: 1.5,
      costRatio: 1.5,
    });
  });

  test("three runs with a zero token estimate and null costs skipped: runs 3, wall 1, tokens 1.5, cost 4", () => {
    const events = [
      ...est("a", 100, 1000, 1),
      ...fin("a", 200, 2000, 4),
      ...est("b", 100, 0, null),
      ...fin("b", 100, 500, 5),
      ...est("c", 100, 1000, 1),
      ...fin("c", 100, 1000, null),
    ];
    expect(estimatesOf(events)).toEqual({
      runs: 3,
      wallRatio: 1,
      tokensRatio: 1.5,
      costRatio: 4,
    });
  });

  test("basis 0, no estimate, and an estimate with no run_finished do not count: runs 1, ratios 3", () => {
    const events = [
      ...est("a", 100, 100, 1, 0),
      ...fin("a", 999, 999, 9),
      { event: "task_started", task: "b" },
      ...fin("b", 999, 999, 9),
      { event: "task_started", task: "c" },
      { event: "estimate", task: "c", wallMs: 1, tokens: 1, costUsd: 1, basis: 1 },
      ...est("d", 100, 100, 1),
      ...fin("d", 300, 300, 3),
    ];
    expect(estimatesOf(events)).toEqual({
      runs: 1,
      wallRatio: 3,
      tokensRatio: 3,
      costRatio: 3,
    });
  });

  test("no events: runs 0, ratios null", () => {
    expect(estimatesOf([])).toEqual({
      runs: 0,
      wallRatio: null,
      tokensRatio: null,
      costRatio: null,
    });
  });
});

describe("plan step 4b: openRunStart rows, observed through setStatus", () => {
  const ago = (ms: number) => new Date(Date.now() - ms);

  test("no events: a final status writes no run_finished (control: an open start does get one)", () => {
    newOne("t");
    newOne("c");
    appendEvent({ event: "task_started", task: "c", category: "bug" }, env, ago(60_000));
    setStatus("t", "ready", undefined, env);
    setStatus("c", "ready", undefined, env);
    expect(ofTask("t", "run_finished")).toHaveLength(0);
    expect(ofTask("c", "run_finished")).toHaveLength(1);
  });

  test("one task_started at A: the run_finished is timed from A", () => {
    newOne("t");
    appendEvent({ event: "task_started", task: "t", category: "bug" }, env, ago(60_000));
    setStatus("t", "ready", undefined, env);
    const [finished] = ofTask("t", "run_finished");
    expect(finished.wallMs).toBeGreaterThanOrEqual(60_000);
    expect(finished.wallMs).toBeLessThan(120_000);
  });

  test("task_started then run_finished: a final status writes nothing more (control: an open start does get one)", () => {
    newOne("t");
    newOne("c");
    appendEvent({ event: "task_started", task: "t", category: "bug" }, env, ago(60_000));
    appendEvent(
      {
        event: "run_finished",
        task: "t",
        status: "ready",
        wallMs: 1,
        tokens: 0,
        costUsd: null,
      },
      env,
      ago(30_000)
    );
    appendEvent({ event: "task_started", task: "c", category: "bug" }, env, ago(60_000));
    setStatus("t", "ready", undefined, env);
    setStatus("c", "ready", undefined, env);
    expect(ofTask("t", "run_finished")).toHaveLength(1);
    expect(ofTask("c", "run_finished")).toHaveLength(1);
  });

  test("task_started A, run_finished, task_started B: the new run_finished is timed from B", () => {
    newOne("t");
    appendEvent(
      { event: "task_started", task: "t", category: "bug" },
      env,
      ago(3_600_000)
    );
    appendEvent(
      {
        event: "run_finished",
        task: "t",
        status: "stuck",
        wallMs: 1,
        tokens: 0,
        costUsd: null,
      },
      env,
      ago(3_599_000)
    );
    appendEvent({ event: "task_started", task: "t", category: "bug" }, env, ago(60_000));
    setStatus("t", "ready", undefined, env);
    const finished = ofTask("t", "run_finished");
    expect(finished).toHaveLength(2);
    expect(finished[1].wallMs).toBeGreaterThanOrEqual(60_000);
    expect(finished[1].wallMs).toBeLessThan(120_000);
  });

  test("task_started of t, then a run_finished of another task u: t's final status writes its run_finished", () => {
    newOne("t");
    appendEvent({ event: "task_started", task: "t", category: "bug" }, env, ago(60_000));
    appendEvent({ event: "run_finished", task: "u", status: "ready" }, env, ago(30_000));
    setStatus("t", "ready", undefined, env);
    const finished = ofTask("t", "run_finished");
    expect(finished).toHaveLength(1);
    expect(finished[0].wallMs).toBeGreaterThanOrEqual(60_000);
  });
});
