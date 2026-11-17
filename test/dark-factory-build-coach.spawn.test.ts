import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILD_SCRIPT,
  buildEnv,
  calls,
  ctx,
  eventsNamed,
  flow,
  git,
  NOOP,
  resultOf,
  roleNames,
  runBuild,
  setScenario,
  setup,
  specText,
  TASK,
  useFreshContext,
} from "./lib/dark-factory-build-harness";

setDefaultTimeout(90_000);

beforeEach(() => {
  useFreshContext(import.meta.file);
});

describe("the coach at the end of a run", () => {
  const stuckScenario = {
    roles: { "code-writer": [NOOP, NOOP, NOOP, NOOP], debugger: [NOOP, NOOP] },
  };

  test("a ready run is coached after the notification and records the counts", () => {
    setup("small");
    expect(runBuild().exitCode).toBe(0);
    expect(roleNames().at(-1)).toBe("coach");
    expect(flow().slice(-3)).toEqual(["notify", "coach_started", "coach_finished"]);
    expect(eventsNamed("coach_finished")[0]).toMatchObject({
      task: TASK,
      created: 0,
      updated: 0,
    });
  });

  test("a stuck run is coached", () => {
    setup("small", stuckScenario);
    expect(runBuild().exitCode).toBe(1);
    expect(roleNames().at(-1)).toBe("coach");
    expect(eventsNamed("coach_finished")).toHaveLength(1);
  });

  test("a failing coach is recorded and changes neither the exit code nor the JSON", () => {
    setup("small");
    const good = runBuild();
    const goodResult = resultOf(good);
    beforeEachReset();
    setup("small", { roles: { coach: [{ exit: 1 }] } });
    const bad = runBuild();
    expect(eventsNamed("coach_failed")).toHaveLength(1);
    expect(eventsNamed("coach_finished")).toHaveLength(0);
    expect(bad.exitCode).toBe(good.exitCode);
    expect(resultOf(bad)).toEqual(goodResult);
  });
});

function beforeEachReset() {
  useFreshContext(import.meta.file);
}

describe("what the orchestrator runs itself", () => {
  test("without a task id it prints one stuck JSON line and exits 1", () => {
    setup("small");
    const run = spawnSync(process.execPath, [BUILD_SCRIPT], {
      env: buildEnv() as Record<string, string>,
      encoding: "utf8",
    });
    const lines = run.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ status: "stuck" });
    expect(run.status).toBe(1);
  });
});

describe("questions go to the PO and the role continues", () => {
  const question = { done: false, summary: "", question: "which file?" };

  test("once the answer is in Decisions a rerun continues on the same worktree and commits", () => {
    setup("small", {
      roles: {
        "code-writer": [{ write: { "part.txt": "p" }, commit: true, reply: question }],
        po: [{ reply: { userQuestion: "Which database?" } }],
      },
    });
    expect(runBuild().exitCode).toBe(3);
    writeFileSync(
      join(ctx.factory, "tasks", TASK, "spec.md"),
      `${specText()}- Rico: use postgres\n`
    );
    setScenario({});
    const run = runBuild();
    expect(run.exitCode).toBe(0);
    expect(resultOf(run).status).toBe("ready");
    expect(git(ctx.worktree, "rev-list", "--count", "origin/canary..HEAD")).toBe("2");
    expect(existsSync(join(ctx.worktree, "part.txt"))).toBe(true);
  });

  test("a rerun of a feature task that stopped in the code step does not redo the before roles", () => {
    setup("feature", {
      roles: {
        "code-writer": [
          { write: { "feature.txt": "code" }, commit: true, reply: question },
        ],
        po: [{ reply: { userQuestion: "Which database?" } }],
      },
    });
    expect(runBuild().exitCode).toBe(3);
    writeFileSync(join(ctx.factory, "tasks", TASK, "plan.md"), "plan\n");
    writeFileSync(
      join(ctx.factory, "tasks", TASK, "spec.md"),
      `${specText()}- Rico: use postgres\n`
    );
    setScenario({});
    const callsBeforeRerun = calls().length;
    const run = runBuild();
    expect(run.exitCode).toBe(0);
    expect(resultOf(run).status).toBe("ready");
    const rerunRoles = calls()
      .slice(callsBeforeRerun)
      .map((call) => call.role);
    expect(rerunRoles).not.toContain("test-writer");
    expect(rerunRoles).not.toContain("planner");
  });
});
