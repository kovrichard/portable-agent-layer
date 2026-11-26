import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { appendEvent } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import {
  type FactoryEnv,
  freshFactoryHome,
  PLUGIN_ROOT,
} from "./lib/dark-factory-scripts-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

let env: FactoryEnv;

beforeEach(() => {
  ({ env } = freshFactoryHome(import.meta.file));
});

function stats(...args: string[]) {
  const result = spawnSync("node", [join(PLUGIN_ROOT, "scripts/stats.mjs"), ...args], {
    encoding: "utf8",
    env: env as NodeJS.ProcessEnv,
  });

  return { status: result.status, out: result.stdout };
}

describe("node stats.mjs <task-id>", () => {
  test("prints the task's report as one JSON document", () => {
    const at = (iso: string) => new Date(iso);
    appendEvent(
      { event: "task_started", task: "t1", category: "bug" },
      env,
      at("2026-11-01T10:00:00Z")
    );
    appendEvent(
      {
        event: "role_finished",
        task: "t1",
        role: "planner",
        model: "claude-sonnet-5-5",
        inputTokens: 1000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        turns: 1,
        toolCalls: 0,
        durationMs: 5,
        costUsd: 0.25,
      },
      env,
      at("2026-11-01T10:00:30Z")
    );
    appendEvent(
      {
        event: "run_finished",
        task: "t1",
        status: "ready",
        costUsd: 0.25,
        wallMs: 60000,
      },
      env,
      at("2026-11-01T10:01:00Z")
    );
    const { status, out } = stats("t1");
    expect(status).toBe(0);
    const report = JSON.parse(out);
    expect(report.task).toBe("t1");
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      status: "ready",
      costUsd: 0.25,
      costEstimated: false,
    });
    expect(report.runs[0].byRole[0]).toMatchObject({ role: "planner", runs: 1 });
  });

  test("for a task with no events prints no runs and exits 0", () => {
    const { status, out } = stats("nope");
    expect(status).toBe(0);
    expect(JSON.parse(out)).toEqual({ task: "nope", runs: [] });
  });

  test("without an argument still prints the summary, with costByRole", () => {
    const { status, out } = stats();
    expect(status).toBe(0);
    const summary = JSON.parse(out);
    expect(summary).toHaveProperty("tasks");
    expect(summary).toHaveProperty("costByRole");
  });
});
