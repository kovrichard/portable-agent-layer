import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  appendEvent,
  readEvents,
  readTask,
  taskDir,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { transcriptCost } from "../assets/plugins/dark-factory/scripts/prices.mjs";
import {
  estimateFor,
  summarize,
  taskReport,
} from "../assets/plugins/dark-factory/scripts/stats.mjs";
import { prepare, setStatus } from "../assets/plugins/dark-factory/scripts/task.mjs";
import { jsonl, message } from "./lib/dark-factory-cost-fixture";
import {
  eventsNamedIn,
  type FactoryEnv,
  freshFactoryHome,
} from "./lib/dark-factory-scripts-fixture";

setDefaultTimeout(30000);

const SONNET = "claude-sonnet-5-5";
const README = readFileSync(
  join(import.meta.dir, "../assets/plugins/dark-factory/README.md"),
  "utf8"
);
const HOOKS = join(import.meta.dir, "../assets/plugins/dark-factory/hooks/hooks.json");

const T0 = new Date("2026-11-11T09:06:19.293Z");
const T_PO = new Date("2026-11-11T09:10:00.000Z");
const T_FIN = new Date("2026-11-11T09:26:19.000Z");
const T_TAIL = "2026-11-11T09:26:35.006Z";

const usage = (n: number) => ({ input_tokens: n, output_tokens: n });

let home: string;
let env: FactoryEnv;
let id: string;
let worktree: string;
let projects: string;

function seedTask() {
  mkdirSync(join(home, "repo"), { recursive: true });
  writeFileSync(
    join(home, "repo", ".dark-factory.json"),
    JSON.stringify({ gate: [], baseBranch: "canary" })
  );
  id = "t1";
  worktree = join(home, "worktrees", id);
  mkdirSync(worktree, { recursive: true });
  mkdirSync(taskDir(id, env), { recursive: true });
  writeTask(
    {
      id,
      title: "x",
      repo: join(home, "repo"),
      category: "small",
      status: "draft",
      worktree,
    },
    env
  );
  writeFileSync(join(taskDir(id, env), "spec.md"), "## Goal\n\nx\n");
  projects = join(home, "projects");
}

beforeEach(() => {
  ({ home, env } = freshFactoryHome(import.meta.file));
  delete env.DARK_FACTORY_ROLE;
  seedTask();
});

const ofTask = (name: string) =>
  readEvents(env).filter((e: { event: string; task?: string }) => e.event === name);

describe("prepare on a running task with an open run (criteria 1 and 2)", () => {
  test("running twice leaves one task_started, one estimate and status running", () => {
    prepare(id, env);
    prepare(id, env);
    expect(ofTask("task_started")).toHaveLength(1);
    expect(ofTask("estimate")).toHaveLength(1);
    expect((readTask(id, env) as { status: string }).status).toBe("running");
  });

  test("a third call adds no task_started and no estimate either", () => {
    prepare(id, env);
    prepare(id, env);
    const started = ofTask("task_started").length;
    const estimates = ofTask("estimate").length;
    prepare(id, env);
    expect(ofTask("task_started")).toHaveLength(started);
    expect(ofTask("estimate")).toHaveLength(estimates);
  });

  test("a stuck task starts a run as before", () => {
    writeTask({ ...(readTask(id, env) as object), status: "stuck" }, env);
    prepare(id, env);
    expect(ofTask("task_started")).toHaveLength(1);
    expect((readTask(id, env) as { status: string }).status).toBe("running");
  });

  test("a running task whose run was finished starts a new run", () => {
    prepare(id, env);
    appendEvent({ event: "run_finished", task: id, status: "stuck" }, env);
    writeTask({ ...(readTask(id, env) as object), status: "running" }, env);
    prepare(id, env);
    expect(ofTask("task_started")).toHaveLength(2);
  });

  test("a PO message before the second prepare is counted by the po event", () => {
    appendEvent({ event: "task_started", task: id, category: "small" }, env, T0);
    writeTask({ ...(readTask(id, env) as object), status: "running" }, env);
    const session = "po-sess";
    const poFile = join(projects, `${session}.jsonl`);
    mkdirSync(dirname(poFile), { recursive: true });
    writeFileSync(
      poFile,
      jsonl([
        message("first", SONNET, usage(1000), { ts: "2026-11-11T09:06:39.954Z" }),
        message("mid", SONNET, usage(2000), { ts: "2026-11-11T09:10:00.000Z" }),
      ])
    );
    appendEvent(
      {
        event: "role_finished",
        task: id,
        role: "planner",
        model: SONNET,
        costUsd: 0.5,
        turns: 1,
        transcriptPath: join(projects, session, "subagents", "agent-a1.jsonl"),
      },
      env,
      T_PO
    );
    prepare(id, env);
    setStatus(id, "ready", undefined, env);
    const po = eventsNamedIn(env, "role_finished").find(
      (e: { role: string }) => e.role === "po"
    );
    expect(po.turns).toBe(2);
    expect(po.inputTokens).toBe(3000);
  });
});

describe("the SessionEnd hook", () => {
  const SESSION = "po-sess";
  let hook: (input: Record<string, unknown>, env: FactoryEnv) => unknown;

  beforeEach(async () => {
    const mod = await import(
      "../assets/plugins/dark-factory/scripts/session-end.mjs" as string
    );
    hook = mod.recordSessionEnd;
  });

  function transcript(lines: unknown[]) {
    const file = join(projects, `${SESSION}.jsonl`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, jsonl(lines));
    return file;
  }

  function finishedRun(file: string, finish = true) {
    appendEvent({ event: "task_started", task: id, category: "small" }, env, T0);
    appendEvent(
      {
        event: "role_finished",
        task: id,
        role: "po",
        model: SONNET,
        turns: 1,
        costUsd: 1,
        sessionId: SESSION,
        transcriptPath: file,
      },
      env,
      T_PO
    );
    if (finish) {
      appendEvent({ event: "run_finished", task: id, status: "ready" }, env, T_FIN);
    }
  }

  const tailMessage = () =>
    message("tail", SONNET, usage(4000), { ts: T_TAIL, tools: 2 });
  const input = (overrides: Record<string, unknown> = {}) => ({
    hook_event_name: "SessionEnd",
    session_id: SESSION,
    cwd: worktree,
    reason: "other",
    ...overrides,
  });
  const poEvents = () =>
    eventsNamedIn(env, "role_finished").filter((e: { role: string }) => e.role === "po");

  test("is registered in hooks.json", () => {
    const hooks = JSON.parse(readFileSync(HOOKS, "utf8")).hooks;
    expect(JSON.stringify(hooks.SessionEnd)).toContain("session-end.mjs");
    expect(hooks.SubagentStop).toBeDefined();
  });

  test("appends one afterRunFinished po event counting only the later message", () => {
    const file = transcript([
      message("early", SONNET, usage(1000), { ts: "2026-11-11T09:09:00.000Z" }),
      tailMessage(),
    ]);
    transcript([
      message("early", SONNET, usage(1000), { ts: "2026-11-11T09:09:00.000Z" }),
      tailMessage(),
    ]);
    finishedRun(file);
    hook(input(), env);
    const events = poEvents();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      task: id,
      role: "po",
      afterRunFinished: true,
      sessionId: SESSION,
      transcriptPath: file,
      turns: 1,
      toolCalls: 2,
      inputTokens: 4000,
      outputTokens: 4000,
      costUsd: transcriptCost([tailMessage()]),
    });
  });

  test("a second SessionEnd for the same session adds nothing", () => {
    const file = transcript([tailMessage()]);
    finishedRun(file);
    hook(input(), env);
    const before = readEvents(env).length;
    hook(input(), env);
    expect(readEvents(env)).toHaveLength(before);
  });

  test("a session that is not a PO session of the run writes nothing", () => {
    const file = transcript([tailMessage()]);
    finishedRun(file);
    const before = readEvents(env).length;
    hook(input({ session_id: "other-session" }), env);
    expect(readEvents(env)).toHaveLength(before);
  });

  test("an open run writes nothing", () => {
    const file = transcript([tailMessage()]);
    finishedRun(file, false);
    const before = readEvents(env).length;
    hook(input(), env);
    expect(readEvents(env)).toHaveLength(before);
  });

  test("no message after the po event writes nothing", () => {
    const file = transcript([
      message("early", SONNET, usage(1000), { ts: "2026-11-11T09:09:00.000Z" }),
    ]);
    finishedRun(file);
    const before = readEvents(env).length;
    hook(input(), env);
    expect(readEvents(env)).toHaveLength(before);
  });

  test("inside a build.mjs role writes nothing", () => {
    const file = transcript([tailMessage()]);
    finishedRun(file);
    const before = readEvents(env).length;
    hook(input(), { ...env, DARK_FACTORY_ROLE: "po" });
    expect(readEvents(env)).toHaveLength(before);
  });

  test("a cwd outside every worktree writes nothing", () => {
    const file = transcript([tailMessage()]);
    finishedRun(file);
    const before = readEvents(env).length;
    hook(input({ cwd: home }), env);
    expect(readEvents(env)).toHaveLength(before);
  });

  test("a missing transcript writes nothing and does not throw", () => {
    finishedRun(join(projects, "gone.jsonl"));
    const before = readEvents(env).length;
    expect(() =>
      hook(input({ transcript_path: join(home, "nope.jsonl") }), env)
    ).not.toThrow();
    expect(readEvents(env)).toHaveLength(before);
  });
});

describe("stats and the afterRunFinished event (criteria 5 to 8)", () => {
  const ev = (event: string, ts: string, extra: Record<string, unknown> = {}) => ({
    event,
    task: "t1",
    ts,
    ...extra,
  });
  const role = (ts: string, role: string, costUsd: number, extra = {}) =>
    ev("role_finished", ts, {
      role,
      model: SONNET,
      costUsd,
      inputTokens: 10,
      outputTokens: 10,
      turns: 1,
      ...extra,
    });

  const events = [
    ev("task_started", "2026-11-11T09:00:00.000Z", { category: "small" }),
    role("2026-11-11T09:05:00.000Z", "code-writer", 0.25),
    role("2026-11-11T09:09:00.000Z", "po", 1.5, { sessionId: "s" }),
    ev("run_finished", "2026-11-11T09:10:00.000Z", {
      status: "ready",
      costUsd: 1.75,
      wallMs: 1,
      tokens: 1,
    }),
    role("2026-11-11T09:11:00.000Z", "po", 0.0625, {
      sessionId: "s",
      afterRunFinished: true,
    }),
  ];

  test("taskReport adds the tail to the run it follows (criterion 5)", () => {
    const report = taskReport(events, "t1");
    expect(report.runs).toHaveLength(1);
    const run = report.runs[0];
    expect(run.costUsd).toBeCloseTo(1.8125, 10);
    expect(run.tokens.input).toBe(30);
    const po = run.byRole.find((r: { role: string }) => r.role === "po");
    expect(po?.runs).toBe(1);
    expect(po?.costUsd).toBeCloseTo(1.5625, 10);
  });

  test("the tail goes to the latest run finished before it (criterion 5)", () => {
    const two = [
      ...events.slice(0, 4),
      ev("task_started", "2026-11-11T10:00:00.000Z", { category: "small" }),
      role("2026-11-11T10:01:00.000Z", "code-writer", 0.5),
      ev("run_finished", "2026-11-11T10:02:00.000Z", { status: "ready", costUsd: 0.5 }),
      role("2026-11-11T10:03:00.000Z", "po", 0.125, { afterRunFinished: true }),
    ];
    const [first, second] = taskReport(two, "t1").runs;
    expect(first.costUsd).toBeCloseTo(1.75, 10);
    expect(second.costUsd).toBeCloseTo(0.625, 10);
  });

  test("estimateFor includes the tail in the run cost (criterion 6)", () => {
    const withCategory = [{ ...events[0] }, ...events.slice(1)];
    expect(estimateFor(withCategory, "small").costUsd).toBeCloseTo(1.8125, 10);
  });

  test("summarize counts the tail cost but not a run (criterion 7)", () => {
    const po = summarize(events).costByRole.po;
    expect(po.runs).toBe(1);
    expect(po.costUsd).toBeCloseTo(1.5625, 10);
  });

  test("a tail with no finished run before it is only in costByRole (edge)", () => {
    const orphan = [
      ev("task_started", "2026-11-11T09:00:00.000Z", { category: "small" }),
      role("2026-11-11T09:01:00.000Z", "po", 0.5, { afterRunFinished: true }),
    ];
    const report = taskReport(orphan, "t1");
    for (const run of report.runs) expect(run.costUsd ?? 0).toBe(0);
    expect(summarize(orphan).costByRole.po.costUsd).toBeCloseTo(0.5, 10);
    expect(summarize(orphan).costByRole.po.runs).toBe(0);
  });

  test("a three-message PO session adds up to the run total (criterion 8)", () => {
    const first = 0.084515;
    const middle = 1.4375668 - 0.084515;
    const last = 0.0636028;
    const shaped = [
      ev("task_started", "2026-11-11T09:06:19.293Z", { category: "small" }),
      role("2026-11-11T09:10:00.000Z", "code-writer", 0.5),
      role("2026-11-11T09:20:00.000Z", "po", first + middle, { sessionId: "s" }),
      ev("run_finished", "2026-11-11T09:26:19.000Z", { status: "ready" }),
      role("2026-11-11T09:26:35.006Z", "po", last, {
        sessionId: "s",
        afterRunFinished: true,
      }),
    ];
    const [run] = taskReport(shaped, "t1").runs;
    expect(run.costUsd).toBeCloseTo(0.5 + first + middle + last, 9);
  });
});

describe("the README (criterion 9)", () => {
  test("names afterRunFinished and SessionEnd", () => {
    expect(README).toContain("afterRunFinished");
    expect(README).toContain("SessionEnd");
  });
});
