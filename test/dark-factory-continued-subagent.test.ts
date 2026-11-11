import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendEvent,
  taskDir,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { transcriptCost } from "../assets/plugins/dark-factory/scripts/prices.mjs";
import { summarize, taskReport } from "../assets/plugins/dark-factory/scripts/stats.mjs";
import { recordSubagentStop } from "../assets/plugins/dark-factory/scripts/subagent-stop.mjs";
import { newTask } from "../assets/plugins/dark-factory/scripts/task.mjs";
import { jsonl, message } from "./lib/dark-factory-cost-fixture";
import {
  eventsNamedIn,
  type FactoryEnv,
  freshFactoryHome,
  NOW,
} from "./lib/dark-factory-scripts-fixture";

const SONNET = "claude-sonnet-5-5";
const usage = (input: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
});

describe("a subagent continued with SendMessage (criterion 12)", () => {
  let home: string;
  let env: FactoryEnv;
  let id: string;
  let worktree: string;
  let file: string;

  beforeEach(() => {
    ({ home, env } = freshFactoryHome(import.meta.file));
    delete env.DARK_FACTORY_ROLE;
    ({ id } = newTask({ title: "Fix login", repo: "/repo", category: "bug" }, env, NOW));
    worktree = join(home, "worktrees", id);
    mkdirSync(worktree, { recursive: true });
    const task = JSON.parse(readFileSync(join(taskDir(id, env), "task.json"), "utf8"));
    writeTask({ ...task, worktree }, env);
    file = join(home, "agent.jsonl");
  });

  const stop = (agentId: string | undefined) =>
    recordSubagentStop(
      {
        agent_id: agentId,
        agent_type: "dark-factory:planner",
        agent_transcript_path: file,
        last_assistant_message: "",
        cwd: worktree,
      },
      env,
      0
    );

  const finished = () => eventsNamedIn(env, "role_finished");
  const at = (base: string, seconds: number) =>
    new Date(Date.parse(base) + seconds * 1000).toISOString();

  const early = [
    message("m1", SONNET, usage(1000, 100), {
      ts: "2026-11-08T08:00:00.000Z",
      tools: 1,
    }),
    message("m2", SONNET, usage(2000, 200), {
      ts: "2026-11-08T08:00:05.000Z",
      tools: 2,
    }),
  ];

  function grown() {
    const [first] = finished();
    return [
      ...early,
      message("m3", SONNET, usage(4000, 400), { ts: at(first.ts, 10), tools: 3 }),
      message("m4", SONNET, usage(8000, 800), { ts: at(first.ts, 14), tools: 4 }),
    ];
  }

  test("the second stop counts only the messages added since the first", () => {
    writeFileSync(file, jsonl(early));
    stop("a1");
    const transcript = grown();
    writeFileSync(file, jsonl(transcript));
    stop("a1");
    const [one, two] = finished();
    expect(one).toMatchObject({ inputTokens: 3000, outputTokens: 300, turns: 2 });
    expect(two).toMatchObject({
      inputTokens: 12000,
      outputTokens: 1200,
      turns: 2,
      toolCalls: 7,
      durationMs: 4000,
    });
    expect(two.costUsd).toBeCloseTo((12000 * 2 + 1200 * 10) / 1_000_000, 9);
    expect(one.costUsd + two.costUsd).toBeCloseTo(
      transcriptCost(transcript) ?? Number.NaN,
      9
    );
  });

  test("a stop with nothing new since the last one counts nothing", () => {
    writeFileSync(file, jsonl(early));
    stop("a1");
    stop("a1");
    const [, again] = finished();
    expect(again).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      toolCalls: 0,
      durationMs: 0,
      costUsd: 0,
    });
  });

  test("an event without an agentId counts the whole transcript every time", () => {
    writeFileSync(file, jsonl(early));
    stop(undefined);
    writeFileSync(file, jsonl(grown()));
    stop(undefined);
    expect(finished().map((e: { turns: number }) => e.turns)).toEqual([2, 4]);
  });

  test("another agent's first stop counts its whole transcript", () => {
    writeFileSync(file, jsonl(early));
    stop("a1");
    writeFileSync(file, jsonl(grown()));
    stop("a2");
    expect(finished().map((e: { turns: number }) => e.turns)).toEqual([2, 4]);
  });

  const three = () => [
    message("m1", SONNET, usage(1000, 100), { ts: "2026-11-08T08:00:01.000Z", tools: 1 }),
    message("m2", SONNET, usage(2000, 200), { ts: "2026-11-08T08:00:05.000Z", tools: 2 }),
    message("m3", SONNET, usage(4000, 400), { ts: "2026-11-08T08:00:07.000Z", tools: 3 }),
  ];
  const user = {
    type: "user",
    timestamp: "2026-11-08T08:00:00.000Z",
    message: { role: "user", content: "hi" },
  };
  const CUT = "2026-11-08T08:00:06.000Z";
  const priorStop = (ts: string, agentId = "a1", task = id) =>
    appendEvent({ event: "role_finished", task, role: "planner", agentId, ts }, env);
  const last = () => finished().at(-1);

  test("no earlier stop of the agent: the whole transcript counts", () => {
    writeFileSync(file, jsonl(three()));
    stop("a1");
    expect(last()).toMatchObject({ inputTokens: 7000, turns: 3 });
  });

  test("an earlier stop of the agent: only the messages after its ts count", () => {
    priorStop("2026-11-08T08:00:03.000Z");
    writeFileSync(file, jsonl(three()));
    stop("a1");
    expect(last()).toMatchObject({ inputTokens: 6000, turns: 2 });
  });

  test("several earlier stops of the agent: the last one is the cut", () => {
    priorStop("2026-11-08T08:00:03.000Z");
    priorStop("2026-11-08T08:00:06.000Z");
    writeFileSync(file, jsonl(three()));
    stop("a1");
    expect(last()).toMatchObject({ inputTokens: 4000, turns: 1 });
  });

  test("a stop without an agentId counts the whole transcript", () => {
    priorStop("2026-11-08T08:00:03.000Z");
    writeFileSync(file, jsonl(three()));
    stop(undefined);
    expect(last()).toMatchObject({ inputTokens: 7000, turns: 3 });
  });

  test("an earlier stop of another task is not a cut", () => {
    priorStop("2026-11-08T08:00:03.000Z", "a1", "other-task");
    writeFileSync(file, jsonl(three()));
    stop("a1");
    expect(last()).toMatchObject({ inputTokens: 7000, turns: 3 });
  });

  test("an event of the task that is not role_finished is not a cut", () => {
    appendEvent(
      { event: "role_run", task: id, agentId: "a1", ts: "2026-11-08T08:00:03.000Z" },
      env
    );
    writeFileSync(file, jsonl(three()));
    stop("a1");
    expect(last()).toMatchObject({ inputTokens: 7000, turns: 3 });
  });

  test("an earlier stop of another agent is not a cut", () => {
    priorStop("2026-11-08T08:00:03.000Z", "a2");
    writeFileSync(file, jsonl(three()));
    stop("a1");
    expect(last()).toMatchObject({ inputTokens: 7000, turns: 3 });
  });

  test("without a cut, sums, turns, tool calls, duration and cost are as today", () => {
    writeFileSync(file, jsonl([user, ...three().slice(0, 2)]));
    stop("a1");
    const row = last();
    expect(row).toMatchObject({
      inputTokens: 3000,
      outputTokens: 300,
      turns: 2,
      toolCalls: 3,
      durationMs: 5000,
      model: SONNET,
    });
    expect(row.costUsd).toBeCloseTo(0.009, 9);
  });

  test("with a cut, only the messages after it count, with their sums, cost and duration", () => {
    priorStop(CUT);
    writeFileSync(
      file,
      jsonl([
        user,
        ...three().slice(0, 2),
        message("m3", SONNET, usage(4000, 400), { ts: at(CUT, 10), tools: 3 }),
        message("m4", SONNET, usage(8000, 800), { ts: at(CUT, 14), tools: 4 }),
      ])
    );
    stop("a1");
    const row = last();
    expect(row).toMatchObject({
      inputTokens: 12000,
      outputTokens: 1200,
      turns: 2,
      toolCalls: 7,
      durationMs: 4000,
      model: SONNET,
    });
    expect(row.costUsd).toBeCloseTo(0.036, 9);
  });

  test("with a cut and nothing after it, everything counts zero and the model stays", () => {
    priorStop(CUT);
    writeFileSync(file, jsonl([user, ...three().slice(0, 2)]));
    stop("a1");
    expect(last()).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 0,
      toolCalls: 0,
      durationMs: 0,
      costUsd: 0,
      model: SONNET,
    });
  });

  test("a message exactly at the cut is not counted", () => {
    priorStop(CUT);
    writeFileSync(file, jsonl([message("m1", SONNET, usage(1000, 100), { ts: CUT })]));
    stop("a1");
    expect(last()).toMatchObject({ turns: 0, inputTokens: 0 });
  });

  test("an assistant message without a timestamp is not counted", () => {
    priorStop(CUT);
    writeFileSync(
      file,
      jsonl([
        {
          type: "assistant",
          message: {
            id: "m1",
            model: SONNET,
            usage: usage(1000, 100),
            content: [{ type: "text", text: "ok" }],
          },
        },
      ])
    );
    stop("a1");
    expect(last()).toMatchObject({ turns: 0, inputTokens: 0 });
  });

  test("an empty transcript with no cut: model default, durationMs null, costUsd 0", () => {
    writeFileSync(file, jsonl([]));
    stop("a1");
    expect(last()).toMatchObject({
      turns: 0,
      durationMs: null,
      costUsd: 0,
      model: "default",
    });
  });
});

describe("the report over cumulative cost-less events (criterion 13)", () => {
  const T0 = "2026-11-08T08:00:00.000Z";
  const T1 = "2026-11-08T09:00:00.000Z";
  const stopEvent = (extra: Record<string, unknown>) => ({
    event: "role_finished",
    task: "t1",
    role: "planner",
    model: SONNET,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    turns: 0,
    agentId: "a1",
    ts: "2026-11-08T08:10:00.000Z",
    ...extra,
  });
  const run = (...roles: unknown[]) => [
    { event: "task_started", task: "t1", ts: T0 },
    ...roles,
    {
      event: "run_finished",
      task: "t1",
      status: "ready",
      costUsd: null,
      tokens: 0,
      roleRuns: roles.length,
      wallMs: 1,
      ts: T1,
    },
  ];
  const planner = (events: unknown[], task = "t1") =>
    // biome-ignore lint/suspicious/noExplicitAny: report shape is checked by the assertions
    (taskReport(events, task).runs[0].byRole as any[]).find((r) => r.role === "planner");

  test("two events of one agent report the later one's sums, not the two added", () => {
    const row = planner(
      run(
        stopEvent({ inputTokens: 100, outputTokens: 200, turns: 3 }),
        stopEvent({ inputTokens: 300, outputTokens: 500, turns: 7 })
      )
    );
    expect(row).toMatchObject({
      runs: 2,
      inputTokens: 300,
      outputTokens: 500,
      turns: 7,
      costEstimated: true,
    });
    expect(row.costUsd).toBeCloseTo((300 * 2 + 500 * 10) / 1_000_000, 9);
  });

  test("cache creation is subtracted too and priced at the 5-minute rate", () => {
    const row = planner(
      run(
        stopEvent({ cacheCreationTokens: 1000, turns: 1 }),
        stopEvent({ cacheCreationTokens: 3000, turns: 2 })
      )
    );
    expect(row.cacheCreationTokens).toBe(3000);
    expect(row.costUsd).toBeCloseTo((3000 * 2.5) / 1_000_000, 9);
  });

  test("a later event holding less than the earlier one is floored at 0", () => {
    const row = planner(
      run(
        stopEvent({ inputTokens: 500, outputTokens: 500, turns: 5 }),
        stopEvent({ inputTokens: 100, outputTokens: 900, turns: 2 })
      )
    );
    // 500 (first, as written) + 0 (floored) input; 500 + 400 output; 5 + 0 turns
    expect(row).toMatchObject({ inputTokens: 500, outputTokens: 900, turns: 5 });
  });

  test("events of different agents are not subtracted from each other", () => {
    const row = planner(
      run(
        stopEvent({ agentId: "a1", inputTokens: 100, turns: 1 }),
        stopEvent({ agentId: "a2", inputTokens: 300, turns: 2 })
      )
    );
    expect(row).toMatchObject({ inputTokens: 400, turns: 3 });
  });

  test("events that carry costUsd are counted as written and added", () => {
    const events = run(
      stopEvent({ inputTokens: 100, turns: 3, costUsd: 0.5 }),
      stopEvent({ inputTokens: 40, turns: 2, costUsd: 0.25 })
    );
    const row = planner(events);
    expect(row).toMatchObject({
      inputTokens: 140,
      turns: 5,
      costEstimated: false,
    });
    expect(row.costUsd).toBeCloseTo(0.75, 9);
    expect(taskReport(events, "t1").runs[0].costUsd).toBeCloseTo(0.75, 9);
  });

  test("the run's cost uses the subtracted sums", () => {
    const events = run(
      stopEvent({ inputTokens: 100, outputTokens: 200, turns: 3 }),
      stopEvent({ inputTokens: 300, outputTokens: 500, turns: 7 })
    );
    const report = taskReport(events, "t1").runs[0];
    expect(report.tokens).toMatchObject({ input: 300, output: 500 });
    expect(report.costUsd).toBeCloseTo((300 * 2 + 500 * 10) / 1_000_000, 9);
  });

  test("costByRole subtracts the earlier event of the same agent", () => {
    const { costByRole } = summarize(
      run(
        stopEvent({ inputTokens: 100, outputTokens: 200, turns: 3 }),
        stopEvent({ inputTokens: 300, outputTokens: 500, turns: 7 })
      )
    );
    expect(costByRole.planner.runs).toBe(2);
    expect(costByRole.planner.costUsd).toBeCloseTo((300 * 2 + 500 * 10) / 1_000_000, 9);
  });

  test("costByRole adds events that carry costUsd", () => {
    const { costByRole } = summarize(
      run(stopEvent({ costUsd: 0.5 }), stopEvent({ costUsd: 0.25 }))
    );
    expect(costByRole.planner.costUsd).toBeCloseTo(0.75, 9);
  });

  const finish = (task: string, ts: string) => ({
    event: "run_finished",
    task,
    status: "ready",
    costUsd: null,
    tokens: 0,
    roleRuns: 1,
    wallMs: 1,
    ts,
  });

  test("row: later event of one agent holds more, becomes the difference", () => {
    const row = planner(
      run(
        stopEvent({ inputTokens: 100, outputTokens: 200, turns: 3 }),
        stopEvent({ inputTokens: 300, outputTokens: 500, turns: 7 })
      )
    );
    expect(row).toMatchObject({ inputTokens: 300, outputTokens: 500, turns: 7 });
  });

  test("row: later event holding less is floored at 0 for each field", () => {
    const row = planner(
      run(
        stopEvent({ inputTokens: 500, outputTokens: 500, turns: 5 }),
        stopEvent({ inputTokens: 100, outputTokens: 900, turns: 2 })
      )
    );
    expect(row).toMatchObject({ inputTokens: 500, outputTokens: 900, turns: 5 });
  });

  test("row: cache creation is subtracted", () => {
    const row = planner(
      run(
        stopEvent({ cacheCreationTokens: 1000, turns: 1 }),
        stopEvent({ cacheCreationTokens: 3000, turns: 2 })
      )
    );
    expect(row.cacheCreationTokens).toBe(3000);
  });

  test("row: events with a numeric costUsd are left as written", () => {
    const row = planner(
      run(
        stopEvent({ inputTokens: 100, turns: 3, costUsd: 0.5 }),
        stopEvent({ inputTokens: 40, turns: 2, costUsd: 0.25 })
      )
    );
    expect(row).toMatchObject({ inputTokens: 140, costEstimated: false });
    expect(row.costUsd).toBeCloseTo(0.75, 9);
  });

  test("row: events of different agents are both left as written", () => {
    const row = planner(
      run(
        stopEvent({ agentId: "a1", inputTokens: 100, turns: 1 }),
        stopEvent({ agentId: "a2", inputTokens: 300, turns: 2 })
      )
    );
    expect(row).toMatchObject({ inputTokens: 400, turns: 3 });
  });

  test("row: events without an agentId are both left as written", () => {
    const row = planner(
      run(
        stopEvent({ agentId: undefined, inputTokens: 100 }),
        stopEvent({ agentId: undefined, inputTokens: 300 })
      )
    );
    expect(row).toMatchObject({ inputTokens: 400 });
  });

  test("row: events of different tasks are both left as written", () => {
    const events = [
      { event: "task_started", task: "t1", ts: T0 },
      stopEvent({ inputTokens: 100 }),
      finish("t1", T1),
      { event: "task_started", task: "t2", ts: T0 },
      stopEvent({ task: "t2", inputTokens: 300 }),
      finish("t2", T1),
    ];
    expect(planner(events, "t1")).toMatchObject({ inputTokens: 100 });
    expect(planner(events, "t2")).toMatchObject({ inputTokens: 300 });
  });

  test("row: an earlier event of the task in an earlier run is subtracted from the later run", () => {
    const events = [
      { event: "task_started", task: "t1", ts: T0 },
      stopEvent({ inputTokens: 100, ts: "2026-11-08T08:10:00.000Z" }),
      finish("t1", T1),
      { event: "task_started", task: "t1", ts: "2026-11-08T10:00:00.000Z" },
      stopEvent({ inputTokens: 300, ts: "2026-11-08T10:10:00.000Z" }),
      finish("t1", "2026-11-08T11:00:00.000Z"),
    ];
    const runs = taskReport(events, "t1").runs as {
      byRole: { role: string; inputTokens: number }[];
    }[];
    expect(runs[0].byRole.find((r) => r.role === "planner")).toMatchObject({
      inputTokens: 100,
    });
    expect(runs[1].byRole.find((r) => r.role === "planner")).toMatchObject({
      inputTokens: 200,
    });
  });
});
