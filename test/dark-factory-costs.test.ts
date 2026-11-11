import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  appendEvent,
  readTask,
  taskDir,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import {
  messageCost,
  PRICES,
  transcriptCost,
} from "../assets/plugins/dark-factory/scripts/prices.mjs";
import { summarize, taskReport } from "../assets/plugins/dark-factory/scripts/stats.mjs";
import { recordSubagentStop } from "../assets/plugins/dark-factory/scripts/subagent-stop.mjs";
import { newTask, setStatus } from "../assets/plugins/dark-factory/scripts/task.mjs";
import { MODEL_PRICING } from "../src/hooks/lib/models";
import { jsonl, message, type Usage } from "./lib/dark-factory-cost-fixture";
import {
  eventsNamedIn,
  type FactoryEnv,
  freshFactoryHome,
  NOW,
} from "./lib/dark-factory-scripts-fixture";

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";
const PLUGIN = join(import.meta.dir, "../assets/plugins/dark-factory");

const priced = (model: string, usage: Usage) => messageCost({ model, usage });

describe("the plugin's price table (criterion 1)", () => {
  test.each([HAIKU, SONNET, OPUS, "claude-fable-5-2"])(
    "%s has the same five rates as PAL's table",
    (id) => {
      const rates = PRICES[id];
      const pal = MODEL_PRICING[id];
      expect(rates).toBeDefined();
      for (const key of [
        "input",
        "output",
        "cacheWrite5m",
        "cacheWrite1h",
        "cacheRead",
      ] as const) {
        expect(rates[key]).toBe(pal[key]);
      }
    }
  );
});

describe("a message's price (criteria 2 and 3)", () => {
  test("all five token kinds are priced at their own rate", () => {
    const cost = priced(SONNET, {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 3000,
      cache_creation: {
        ephemeral_5m_input_tokens: 1000,
        ephemeral_1h_input_tokens: 2000,
      },
    });
    expect(cost).toBeCloseTo(0.0328, 9);
  });

  test("cache creation without a split is priced at the 5-minute rate", () => {
    const cost = priced(SONNET, {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 4000,
    });
    expect(cost).toBeCloseTo(0.0323, 9);
  });

  test("cache creation the split does not account for is priced at the 5-minute rate", () => {
    const cost = priced(SONNET, {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 4000,
      cache_creation: {
        ephemeral_5m_input_tokens: 1500,
        ephemeral_1h_input_tokens: 2000,
      },
    });
    expect(cost).toBeCloseTo(0.0353, 9);
  });

  test("a haiku prompt of exactly 100,000 tokens is not over the long-prompt line", () => {
    const cost = priced(HAIKU, { input_tokens: 100000, output_tokens: 1000 });
    expect(cost).toBeCloseTo(0.0105, 9);
  });

  test("a haiku prompt of 100,001 tokens costs 5 times the table, every kind", () => {
    const cost = priced(HAIKU, { input_tokens: 100001, output_tokens: 1000 });
    expect(cost).toBeCloseTo(0.0525005, 9);
  });

  test("the long-prompt line counts cache reads and creation in the prompt", () => {
    const cost = priced(HAIKU, {
      input_tokens: 1,
      output_tokens: 0,
      cache_read_input_tokens: 50000,
      cache_creation_input_tokens: 50000,
    });
    // (1*0.1 + 50000*0.01 + 50000*0.125) * 5 / 1e6
    expect(cost).toBeCloseTo(0.0337505, 9);
  });

  test("sonnet has no long-prompt rule", () => {
    const cost = priced(SONNET, { input_tokens: 100001, output_tokens: 1000 });
    expect(cost).toBeCloseTo(0.210002, 9);
  });
});

describe("a transcript's cost (criteria 3 and 4)", () => {
  function realRun(withRule: boolean) {
    const longIndexes = new Set([2, 11, 20]);
    const out = Array.from({ length: 25 }, (_, i) =>
      longIndexes.has(i)
        ? message(`m${i}`, HAIKU, {
            input_tokens: 10,
            output_tokens: 1000,
            cache_read_input_tokens: 100000,
            cache_creation_input_tokens: 5000,
            cache_creation: {
              ephemeral_5m_input_tokens: 4000,
              ephemeral_1h_input_tokens: 1000,
            },
          })
        : message(`m${i}`, HAIKU, {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 2000,
            cache_creation: {
              ephemeral_5m_input_tokens: 1500,
              ephemeral_1h_input_tokens: 500,
            },
          })
    );
    return { lines: out, expected: withRule ? 0.05144 : 0.025028 };
  }

  test("25 haiku messages, 3 of them over 100,000 prompt tokens, total the 5x-rule cost", () => {
    const { lines, expected } = realRun(true);
    expect(transcriptCost(lines)).toBeCloseTo(expected, 9);
  });

  test("the same fixture priced flat would be lower, so the rule is what matches", () => {
    const flat = realRun(false).expected;
    expect(transcriptCost(realRun(true).lines)).toBeGreaterThan(flat * 2 - 1e-9);
  });

  test("a message id that appears twice is priced once", () => {
    const m = message("dup", SONNET, { input_tokens: 1000, output_tokens: 1000 });
    expect(transcriptCost([m, m])).toBeCloseTo(0.012, 9);
  });

  test("one message of an unknown model makes the transcript's cost null", () => {
    const lines = [
      message("a", SONNET, { input_tokens: 1000, output_tokens: 1000 }),
      message("b", "claude-mystery-9", { input_tokens: 1000, output_tokens: 1000 }),
    ];
    expect(transcriptCost(lines)).toBeNull();
  });

  test("a transcript with no assistant message costs 0", () => {
    expect(
      transcriptCost([{ type: "user", timestamp: "2026-11-08T08:00:00.000Z" }])
    ).toBe(0);
  });

  test("each message is priced by its own model", () => {
    const lines = [
      message("a", SONNET, { input_tokens: 1000, output_tokens: 0 }),
      message("b", OPUS, { input_tokens: 1000, output_tokens: 0 }),
    ];
    expect(transcriptCost(lines)).toBeCloseTo(0.006, 9);
  });
});

describe("the SubagentStop hook's role_finished (criterion 5)", () => {
  let home: string;
  let env: FactoryEnv;
  let id: string;
  let worktree: string;

  beforeEach(() => {
    ({ home, env } = freshFactoryHome(import.meta.file));
    delete env.DARK_FACTORY_ROLE;
    ({ id } = newTask({ title: "Fix login", repo: "/repo", category: "bug" }, env, NOW));
    worktree = join(home, "worktrees", id);
    mkdirSync(worktree, { recursive: true });
    writeTask({ ...readTask(id, env), worktree }, env);
  });

  function stop(lines: unknown[]) {
    const file = join(home, "agent.jsonl");
    writeFileSync(file, `${jsonl(lines)}\nnot json\n`);
    recordSubagentStop(
      {
        session_id: "parent-session",
        agent_id: "a123",
        agent_type: "dark-factory:code-writer",
        agent_transcript_path: file,
        last_assistant_message: "",
        cwd: worktree,
      },
      env,
      0
    );
    return eventsNamedIn(env, "role_finished");
  }

  test("carries costUsd, the cache split and toolCalls, and keeps today's fields", () => {
    const first = {
      input_tokens: 2,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5000,
      cache_creation: {
        ephemeral_5m_input_tokens: 3000,
        ephemeral_1h_input_tokens: 2000,
      },
    };
    const second = {
      input_tokens: 3,
      output_tokens: 50,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 200,
    };
    const m1 = message("msg_1", HAIKU, first, {
      ts: "2026-11-08T08:00:01.000Z",
      tools: 2,
    });
    const m2 = message("msg_2", HAIKU, second, {
      ts: "2026-11-08T08:00:04.000Z",
      tools: 1,
    });
    const events = stop([
      { type: "user", timestamp: "2026-11-08T08:00:00.000Z" },
      m1,
      m1,
      m2,
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      task: id,
      role: "code-writer",
      model: HAIKU,
      inputTokens: 5,
      outputTokens: 150,
      cacheReadTokens: 5000,
      cacheCreationTokens: 5200,
      turns: 2,
      durationMs: 4000,
      agentId: "a123",
      sessionId: "parent-session",
      exitCode: 0,
      error: null,
      cacheCreation5mTokens: 3200,
      cacheCreation1hTokens: 2000,
      toolCalls: 3,
    });
    expect(events[0].costUsd).toBeCloseTo(0.0009255, 9);
  });

  test("a transcript with no assistant message has costUsd 0 and toolCalls 0", () => {
    const [event] = stop([{ type: "user", timestamp: "2026-11-08T08:00:00.000Z" }]);
    expect(event).toMatchObject({ costUsd: 0, toolCalls: 0, turns: 0 });
  });

  test("a transcript with an unknown model has costUsd null", () => {
    const [event] = stop([
      message("x", "claude-mystery-9", { input_tokens: 5, output_tokens: 5 }),
    ]);
    expect(event.costUsd).toBeNull();
  });
});

describe("the PO session's role_finished at a final status (criteria 6, 7 and edges)", () => {
  let home: string;
  let env: FactoryEnv;
  let id: string;
  let projects: string;

  const START = new Date("2026-01-01T00:00:00.000Z");
  const LATER = new Date("2026-01-01T00:01:00.000Z");

  beforeEach(() => {
    ({ home, env } = freshFactoryHome(import.meta.file));
    delete env.DARK_FACTORY_ROLE;
    ({ id } = newTask({ title: "Fix login", repo: "/repo", category: "bug" }, env, NOW));
    projects = join(home, "projects");
    appendEvent({ event: "task_started", task: id, category: "bug" }, env, START);
  });

  const subagentPath = (session: string) =>
    join(projects, session, "subagents", "agent-a1.jsonl");

  function subagentFinished(path: string | null, now = LATER) {
    appendEvent(
      {
        event: "role_finished",
        task: id,
        role: "planner",
        model: SONNET,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0.5,
        turns: 1,
        transcriptPath: path,
      },
      env,
      now
    );
  }

  function poTranscript(session: string, lines: unknown[]) {
    const file = join(projects, `${session}.jsonl`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, jsonl(lines));
    return file;
  }

  const standardLines = () => [
    message(
      "before",
      SONNET,
      { input_tokens: 1000000, output_tokens: 1000000 },
      { ts: "2025-12-31T23:59:00.000Z", tools: 5 }
    ),
    message(
      "p1",
      SONNET,
      { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 1000 },
      { ts: "2026-01-01T00:00:10.000Z", tools: 2 }
    ),
    message(
      "p2",
      OPUS,
      {
        input_tokens: 50,
        output_tokens: 100,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 1000,
        cache_creation: {
          ephemeral_5m_input_tokens: 1000,
          ephemeral_1h_input_tokens: 0,
        },
      },
      { ts: "2026-01-01T00:00:25.000Z", tools: 1 }
    ),
  ];

  const poEvents = () =>
    eventsNamedIn(env, "role_finished").filter((e: { role: string }) => e.role === "po");

  test("appends one po event counting only messages from the run's start", () => {
    const file = poTranscript("sess1", standardLines());
    subagentFinished(subagentPath("sess1"));
    setStatus(id, "ready", undefined, env);
    const events = poEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      task: id,
      role: "po",
      model: OPUS,
      inputTokens: 150,
      outputTokens: 300,
      cacheReadTokens: 3000,
      cacheCreationTokens: 1000,
      cacheCreation5mTokens: 1000,
      cacheCreation1hTokens: 0,
      turns: 2,
      toolCalls: 3,
      durationMs: 15000,
      sessionId: "sess1",
      transcriptPath: file,
      exitCode: 0,
      error: null,
    });
    expect(events[0].costUsd).toBeCloseTo(0.0099, 9);
  });

  test("the po event comes before run_finished, which totals it", () => {
    poTranscript("sess1", standardLines());
    subagentFinished(subagentPath("sess1"));
    setStatus(id, "ready", undefined, env);
    const names = eventsNamedIn(env, "role_finished").length;
    expect(names).toBe(2);
    const all = readFileSync(join(taskDir(id, env), "events.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const poAt = all.findIndex((e) => e.event === "role_finished" && e.role === "po");
    const doneAt = all.findIndex((e) => e.event === "run_finished");
    expect(poAt).toBeGreaterThan(-1);
    expect(poAt).toBeLessThan(doneAt);
    const [done] = eventsNamedIn(env, "run_finished");
    expect(done.costUsd).toBeCloseTo(0.5099, 9);
    expect(done.tokens).toBe(30 + 4450);
    expect(done.roleRuns).toBe(2);
  });

  test("a second final status in the same run adds no second po event", () => {
    poTranscript("sess1", standardLines());
    subagentFinished(subagentPath("sess1"));
    setStatus(id, "ready", undefined, env);
    const before = readFileSync(join(home, "events.jsonl"), "utf8");
    const roleEvents = eventsNamedIn(env, "role_finished").length;
    setStatus(id, "ready", undefined, env);
    expect(poEvents()).toHaveLength(1);
    expect(eventsNamedIn(env, "role_finished")).toHaveLength(roleEvents);
    expect(eventsNamedIn(env, "run_finished")).toHaveLength(1);
    expect(readFileSync(join(home, "events.jsonl"), "utf8").startsWith(before)).toBe(
      true
    );
  });

  test("two PO sessions in one run give one po event each", () => {
    poTranscript("sess1", standardLines());
    poTranscript("sess2", [
      message(
        "q1",
        SONNET,
        { input_tokens: 1000, output_tokens: 0 },
        { ts: "2026-01-01T00:00:40.000Z" }
      ),
    ]);
    subagentFinished(subagentPath("sess1"));
    subagentFinished(subagentPath("sess1"));
    subagentFinished(subagentPath("sess2"));
    setStatus(id, "stuck", undefined, env);
    const events = poEvents();
    expect(events.map((e: { sessionId: string }) => e.sessionId).sort()).toEqual([
      "sess1",
      "sess2",
    ]);
  });

  test("a missing PO transcript adds no po event and the run still finishes", () => {
    subagentFinished(subagentPath("nowhere"));
    setStatus(id, "ready", undefined, env);
    expect(poEvents()).toHaveLength(0);
    expect(eventsNamedIn(env, "run_finished")).toHaveLength(1);
    expect(readTask(id, env).status).toBe("ready");
  });

  test("a PO transcript that cannot be read adds no po event and the run still finishes", () => {
    mkdirSync(join(projects, "sess1.jsonl"), { recursive: true }); // a folder, not a file
    subagentFinished(subagentPath("sess1"));
    expect(() => setStatus(id, "waiting", undefined, env)).not.toThrow();
    expect(poEvents()).toHaveLength(0);
    expect(eventsNamedIn(env, "run_finished")).toHaveLength(1);
  });

  test("a PO transcript with no message at or after the start adds no po event", () => {
    poTranscript("sess1", [standardLines()[0]]);
    subagentFinished(subagentPath("sess1"));
    setStatus(id, "ready", undefined, env);
    expect(poEvents()).toHaveLength(0);
  });

  test("a run with no subagent transcriptPath (a build.mjs run) adds no po event", () => {
    poTranscript("sess1", standardLines());
    subagentFinished(null);
    subagentFinished(join(projects, "sess1", "agent.jsonl"));
    setStatus(id, "ready", undefined, env);
    expect(poEvents()).toHaveLength(0);
    const [done] = eventsNamedIn(env, "run_finished");
    expect(done.costUsd).toBeCloseTo(1.0, 9);
    expect(done.roleRuns).toBe(2);
  });

  test("a run with no role_finished at all adds no po event", () => {
    poTranscript("sess1", standardLines());
    setStatus(id, "ready", undefined, env);
    expect(poEvents()).toHaveLength(0);
  });
});

describe("stats.mjs <task-id> report (criteria 8 and 9)", () => {
  const T0 = "2026-11-01T10:00:00.000Z";
  const T1 = "2026-11-01T10:01:00.000Z";
  const tokens = {
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 300,
    cacheCreationTokens: 400,
  };

  const events = () => [
    { event: "task_started", task: "t1", category: "bug", ts: T0 },
    {
      event: "estimate",
      task: "t1",
      category: "bug",
      basis: 3,
      wallMs: 1,
      tokens: 2,
      costUsd: 3,
      ts: T0,
    },
    {
      event: "role_finished",
      task: "t1",
      role: "code-writer",
      model: SONNET,
      ...tokens,
      turns: 3,
      toolCalls: 4,
      durationMs: 1000,
      costUsd: 0.25,
      ts: T0,
    },
    {
      event: "role_finished",
      task: "t1",
      role: "code-writer",
      model: SONNET,
      ...tokens,
      turns: 5,
      toolCalls: 6,
      durationMs: 2000,
      costUsd: 0.75,
      ts: T0,
    },
    {
      event: "role_finished",
      task: "t1",
      role: "po",
      model: OPUS,
      inputTokens: 1000,
      outputTokens: 2000,
      cacheReadTokens: 0,
      cacheCreationTokens: 1000,
      cacheCreation5mTokens: 400,
      cacheCreation1hTokens: 600,
      turns: 2,
      toolCalls: 1,
      durationMs: 500,
      ts: T0,
    },
    {
      event: "role_finished",
      task: "other",
      role: "planner",
      model: SONNET,
      ...tokens,
      costUsd: 9,
      ts: T0,
    },
    {
      event: "run_finished",
      task: "t1",
      status: "ready",
      costUsd: null,
      tokens: 0,
      roleRuns: 3,
      wallMs: 60000,
      ts: T1,
    },
  ];

  type Row = { role: string; costUsd: number | null; costEstimated: boolean };
  const row = (report: { runs: { byRole: Row[] }[] }, role: string) =>
    report.runs[0].byRole.find((r) => r.role === role) as Row;

  test("lists the run with its totals, estimate and one row per role and model", () => {
    const report = taskReport(events(), "t1");
    expect(report.task).toBe("t1");
    expect(report.runs).toHaveLength(1);
    const run = report.runs[0];
    expect(run).toMatchObject({
      status: "ready",
      startedAt: T0,
      finishedAt: T1,
      wallMs: 60000,
      costEstimated: true,
      tokens: { input: 1200, output: 2400, cacheRead: 600, cacheCreation: 1800 },
    });
    expect(run.costUsd).toBeCloseTo(1.0508, 9);
    expect(run.estimate).toMatchObject({ basis: 3, wallMs: 1, tokens: 2, costUsd: 3 });
    expect(run.byRole).toHaveLength(2);
    expect(row(report, "code-writer")).toMatchObject({
      role: "code-writer",
      model: SONNET,
      runs: 2,
      turns: 8,
      toolCalls: 10,
      durationMs: 3000,
      inputTokens: 200,
      outputTokens: 400,
      cacheReadTokens: 600,
      cacheCreationTokens: 800,
      costUsd: 1,
      costEstimated: false,
    });
    expect(row(report, "po")).toMatchObject({
      runs: 1,
      model: OPUS,
      costEstimated: true,
    });
    expect(row(report, "po").costUsd).toBeCloseTo(0.0508, 9);
  });

  test("an event with costUsd is not estimated", () => {
    const report = taskReport(
      events().filter((e) => e.role !== "po"),
      "t1"
    );
    expect(report.runs[0].costEstimated).toBe(false);
    expect(report.runs[0].costUsd).toBeCloseTo(1, 9);
  });

  test("an event without costUsd is priced at the 5-minute rate with no long-prompt rule", () => {
    const report = taskReport(
      [
        { event: "task_started", task: "t1", ts: T0 },
        {
          event: "role_finished",
          task: "t1",
          role: "planner",
          model: HAIKU,
          inputTokens: 100000,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 10000,
          ts: T0,
        },
        { event: "run_finished", task: "t1", status: "ready", ts: T1 },
      ],
      "t1"
    );
    expect(row(report, "planner").costUsd).toBeCloseTo(0.01125, 9);
    expect(row(report, "planner").costEstimated).toBe(true);
    expect(report.runs[0].costEstimated).toBe(true);
  });

  test("an unknown model's cost is null and stays out of the sums", () => {
    const report = taskReport(
      [
        { event: "task_started", task: "t1", ts: T0 },
        {
          event: "role_finished",
          task: "t1",
          role: "planner",
          model: "claude-mystery-9",
          ...tokens,
          ts: T0,
        },
        {
          event: "role_finished",
          task: "t1",
          role: "tester",
          model: SONNET,
          ...tokens,
          costUsd: 0.5,
          ts: T0,
        },
        { event: "run_finished", task: "t1", status: "ready", ts: T1 },
      ],
      "t1"
    );
    expect(row(report, "planner").costUsd).toBeNull();
    expect(report.runs[0].costUsd).toBeCloseTo(0.5, 9);
  });

  test("a run still open is listed without a finish", () => {
    const report = taskReport(events().slice(0, 4), "t1");
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0].startedAt).toBe(T0);
    expect(report.runs[0].finishedAt).toBeNull();
  });

  test("a task with no events has no runs", () => {
    expect(taskReport([], "t9")).toEqual({ task: "t9", runs: [] });
  });
});

describe("summarize's costByRole (criterion 10)", () => {
  const events = [
    { event: "task_created", task: "t1", category: "bug", ts: "x" },
    {
      event: "role_finished",
      task: "t1",
      role: "code-writer",
      model: SONNET,
      costUsd: 0.25,
      ts: "x",
    },
    {
      event: "role_finished",
      task: "t2",
      role: "code-writer",
      model: SONNET,
      costUsd: 0.75,
      ts: "x",
    },
    {
      event: "role_finished",
      task: "t1",
      role: "po",
      model: SONNET,
      inputTokens: 1000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 1000,
      ts: "x",
    },
  ];

  test("gives runs, distinct tasks, cost and costEstimated per role", () => {
    const { costByRole } = summarize(events);
    expect(costByRole["code-writer"]).toMatchObject({
      runs: 2,
      tasks: 2,
      costEstimated: false,
    });
    expect(costByRole["code-writer"].costUsd).toBeCloseTo(1, 9);
    expect(costByRole.po).toMatchObject({ runs: 1, tasks: 1, costEstimated: true });
    expect(costByRole.po.costUsd).toBeCloseTo(0.0045, 9);
  });

  test("keeps every key printed today", () => {
    const keys = Object.keys(summarize(events));
    for (const key of [
      "tasks",
      "byCategory",
      "outcomes",
      "gateFailuresByCheck",
      "gateFailuresByRole",
      "codeWriterFirstTryPassRate",
      "escalations",
      "ciResults",
      "reviewRounds",
      "questionsToUser",
      "rolesAddedByDiff",
      "roleRuns",
      "handovers",
      "handoversByReason",
      "estimates",
    ]) {
      expect(keys).toContain(key);
    }
  });
});

describe("the docs (criterion 11)", () => {
  const readme = readFileSync(join(PLUGIN, "README.md"), "utf8");
  const skill = readFileSync(join(PLUGIN, "skills/build-with-agents/SKILL.md"), "utf8");

  test("the README no longer says a subagent has no costUsd", () => {
    expect(readme).not.toContain("It has no `costUsd`");
  });

  test("the README and the skill name stats.mjs <task-id>", () => {
    expect(readme).toContain("stats.mjs <");
    expect(skill).toContain("stats.mjs <");
  });

  test("the README documents costByRole and the po event", () => {
    expect(readme).toContain("costByRole");
    expect(readme).toContain('role: "po"');
  });
});
