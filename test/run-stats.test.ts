import { describe, expect, test } from "bun:test";
import type { LoggedEvent } from "../src/hooks/lib/events";
import { costOfUsage, OPUS_MODEL } from "../src/hooks/lib/models";
import { runStats } from "../src/tools/lib/run-stats";

const REPO = "/work/repo";
const WINDOW = {
  scope: REPO,
  startedAt: "2026-11-01T10:00:00.000Z",
  finishedAt: "2026-11-01T12:00:00.000Z",
  sessions: [] as string[],
};
const INSIDE = "2026-11-01T11:00:00.000Z";

function event(
  type: string,
  fields: Record<string, unknown> = {},
  envelope: Partial<LoggedEvent> = {}
): LoggedEvent {
  return {
    v: 1,
    id: `${type}-${Math.random()}`,
    ts: INSIDE,
    type,
    session: "s1",
    runtime: "claude",
    machine: "m",
    actor: "agent",
    authority: "agent",
    channel: null,
    project: null,
    cwd: REPO,
    ...envelope,
    ...fields,
  } as LoggedEvent;
}

const scopeOfCwd = (cwd: string) => (cwd.startsWith(REPO) ? REPO : cwd);

function statsOf(events: LoggedEvent[]) {
  return runStats(events, WINDOW, scopeOfCwd);
}

describe("what a run did", () => {
  test("counts tool calls by tool, program and skill, with failures and subagents", () => {
    const stats = statsOf([
      event("tool_call", { tool: "Bash", outcome: "ok", program: "bun" }),
      event("tool_call", { tool: "Bash", outcome: "failed", program: "git" }),
      event("tool_call", { tool: "Edit", outcome: "ok", program: null }),
      event("tool_call", { tool: "Skill", outcome: "ok", skill: "playwright" }),
      event("tool_call", { tool: "Agent", outcome: "denied", subagent: "Explore" }),
    ]);
    expect(stats).toMatchObject({
      toolCalls: 5,
      toolCallsFailed: 2,
      byTool: { Bash: 2, Edit: 1, Skill: 1, Agent: 1 },
      byProgram: { bun: 1, git: 1 },
      skills: { playwright: 1 },
      subagents: 1,
    });
  });

  test("sums edits, commits, turns, compactions and sessions", () => {
    const stats = statsOf([
      event("action", { linesAdded: 10, linesRemoved: 2 }, { cwd: `${REPO}/src` }),
      event("action", { linesAdded: 5, linesRemoved: 0 }),
      event("commit", { added: 15, deleted: 2 }, { session: null }),
      event("turn"),
      event("compaction", {}, { session: "s2" }),
    ]);
    expect(stats).toMatchObject({
      fileEdits: 2,
      linesAdded: 15,
      linesRemoved: 2,
      commits: 1,
      commitLinesAdded: 15,
      commitLinesDeleted: 2,
      turns: 1,
      compactions: 1,
      sessions: 2,
    });
  });

  test("prices model calls at API rates and counts the ones it cannot price", () => {
    const tokens = {
      inputTokens: 1000,
      outputTokens: 500,
      cacheRead: 20_000,
      cacheWrite5m: 300,
      cacheWrite1h: 200,
    };
    const stats = statsOf([
      event("model_call", { model: OPUS_MODEL, ...tokens, webSearches: 2 }),
      event("model_call", { model: "gpt-5", inputTokens: 10 }, { runtime: "codex" }),
    ]);
    const price = costOfUsage(
      OPUS_MODEL,
      {
        input: 1000,
        output: 500,
        cacheRead: 20_000,
        cacheWrite5m: 300,
        cacheWrite1h: 200,
      },
      INSIDE
    );
    expect(price).toBeGreaterThan(0);
    expect(stats).toMatchObject({
      modelCalls: 2,
      models: [OPUS_MODEL, "gpt-5"],
      inputTokens: 1010,
      outputTokens: 500,
      cacheReadTokens: 20_000,
      cacheWriteTokens: 500,
      webSearches: 2,
      apiCostUsd: price,
      unpricedModelCalls: 1,
    });
  });

  test("leaves out what happened before, after or somewhere else", () => {
    const stats = statsOf([
      event("tool_call", { tool: "Bash" }, { ts: "2026-11-01T09:59:59.000Z" }),
      event("tool_call", { tool: "Bash" }, { ts: "2026-11-01T12:00:01.000Z" }),
      event("tool_call", { tool: "Bash" }, { cwd: "/work/other" }),
      event("tool_call", { tool: "Bash" }, { cwd: "" }),
      event("tool_call", { tool: "Read", outcome: "ok" }, { ts: WINDOW.finishedAt }),
    ]);
    expect(stats.toolCalls).toBe(1);
    expect(stats.byTool).toEqual({ Read: 1 });
  });

  test("with the run's sessions known, a session event counts only when it is one of them", () => {
    const window = { ...WINDOW, sessions: ["s1"] };
    const stats = runStats(
      [
        event("tool_call", { tool: "Bash" }, { session: "s1", cwd: "/work/other" }),
        event("tool_call", { tool: "Read" }, { session: "pal-inference" }),
        event("action", { linesAdded: 3 }, { session: null }),
      ],
      window,
      scopeOfCwd
    );
    expect(stats).toMatchObject({ toolCalls: 1, byTool: { Bash: 1 }, fileEdits: 1 });
  });

  test("a run with no events is all zeros", () => {
    expect(statsOf([])).toMatchObject({
      sessions: 0,
      toolCalls: 0,
      modelCalls: 0,
      apiCostUsd: 0,
      models: [],
      byTool: {},
    });
  });
});
