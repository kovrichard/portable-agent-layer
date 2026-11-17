import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADOPTED_URL,
  calls,
  ctx,
  eventsNamed,
  flow,
  ghCalls,
  git,
  PLUGIN_ROOT,
  PR_URL,
  resultOf,
  roleNames,
  runBuild,
  setup,
  storedTask,
  TASK,
  useFreshContext,
  valueAfter,
} from "./lib/dark-factory-build-harness";

setDefaultTimeout(90_000);

beforeEach(() => {
  useFreshContext(import.meta.file);
});

describe("a whole feature run", () => {
  test("runs the pipeline in order and ends ready with one JSON line and exit 0", () => {
    setup("feature");
    writeFileSync(
      join(ctx.factory, "tasks", TASK, "plan.md"),
      "feature.txt\nfeature.test.txt\n"
    );
    const run = runBuild();
    expect(run.exitCode).toBe(0);
    const result = resultOf(run);
    expect(Object.keys(result).sort()).toEqual(["message", "pr", "status", "task"]);
    expect(result).toMatchObject({ task: TASK, status: "ready", pr: PR_URL });
    expect(result.message).toContain(PR_URL);
    expect(roleNames()).toEqual([
      "test-writer",
      "planner",
      "reviewer",
      "test-writer",
      "code-writer",
      "reviewer",
      "tester",
      "coach",
    ]);
    expect(flow()).toEqual([
      "run_started",
      "task_started",
      "estimate",
      "role:test-writer",
      "tests_red",
      "role:planner",
      "role:reviewer",
      "plan_gate",
      "role:test-writer",
      "role:code-writer",
      "gate",
      "step_done",
      "role:reviewer",
      "review",
      "step_done",
      "role:tester",
      "test",
      "step_done",
      "sync",
      "pushed",
      "pr_opened",
      "ci",
      "pr_ready",
      "task_status",
      "run_finished",
      "notify",
      "coach_started",
      "coach_finished",
    ]);
    expect(ghCalls().some((call) => call.startsWith("pr ready"))).toBe(true);
    expect(storedTask()).toMatchObject({ status: "ready", pr: PR_URL });
  });

  test("every role runs isolated and gets its prompt as the only user message", () => {
    setup("feature");
    runBuild();
    expect(calls().length).toBeGreaterThan(0);

    for (const call of calls()) {
      expect(valueAfter(call.argv, "--setting-sources")).toBe("local");
      expect(valueAfter(call.argv, "--plugin-dir")).toBe(PLUGIN_ROOT);
      expect(call.argv).toContain(`dark-factory:${call.role}`);
      expect(call.stdin.startsWith(`Task ${TASK}:`)).toBe(true);
      expect(call.stdin).not.toContain("Run exactly this command");
    }
  });

  test("the new tests are still uncommitted when the code writer starts", () => {
    setup("feature");
    runBuild();
    const codeWriter = calls().find((call) => call.role === "code-writer");
    expect(codeWriter?.status).toContain("?? feature.test.txt");
  });

  test("an open pull request for the branch is adopted instead of a new one", () => {
    setup("small", { prList: JSON.stringify([{ url: ADOPTED_URL }]) });
    const run = runBuild();
    expect(resultOf(run)).toMatchObject({ status: "ready", pr: ADOPTED_URL });
    expect(ghCalls().some((call) => call.startsWith("pr create"))).toBe(false);
    expect(eventsNamed("pr_adopted")).toHaveLength(1);
  });
});

describe("red tests", () => {
  test("no commit in the worktree is made by the orchestrator before the code writer", () => {
    setup("feature");
    runBuild();
    expect(calls().find((call) => call.role === "code-writer")?.status).not.toBe("");
    expect(git(ctx.worktree, "log", "--format=%s", "origin/canary..HEAD")).toBe(
      "feat: work"
    );
  });
});
