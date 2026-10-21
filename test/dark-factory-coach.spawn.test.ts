import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appliedReport,
  listFindings,
  runCoach,
} from "../assets/plugins/dark-factory/scripts/coach.mjs";
import { userCorrections } from "../assets/plugins/dark-factory/scripts/corrections.mjs";
import {
  readFindings,
  writeFindings,
} from "../assets/plugins/dark-factory/scripts/findings.mjs";
import {
  appendEvent,
  readEvents,
  readTask,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import {
  coachResult,
  env,
  finding,
  NOW,
  PLUGIN_ROOT,
  paths,
  replyWith,
  resumeWith,
  startEachTestInAFreshFactory,
} from "./lib/dark-factory-coach-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const COACH_SCRIPT = join(PLUGIN_ROOT, "scripts/coach.mjs");

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: env() });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commitFile(cwd: string, name: string, content: string, message = name) {
  mkdirSync(join(cwd, name, ".."), { recursive: true });
  writeFileSync(join(cwd, name), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
}

function seedRepoWithRemote() {
  const remote = join(paths.root, "remote.git");
  mkdirSync(paths.repo, { recursive: true });
  git(paths.root, "init", "-q", "--bare", "-b", "canary", remote);
  git(paths.repo, "init", "-q", "-b", "canary");
  commitFile(paths.repo, "README.md", "repo\n", "init");
  git(paths.repo, "remote", "add", "origin", remote);
  git(paths.repo, "push", "-q", "origin", "canary");
  git(paths.repo, "checkout", "-q", "-b", "factory/t1");
}

function claudeCalls(): { argv: string[]; stdin: string }[] {
  return readFileSync(paths.claudeLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function seedTask(id: string, extra: object = {}) {
  writeTask(
    {
      id,
      title: "A task",
      repo: paths.repo,
      category: "small",
      base: "canary",
      branch: "factory/t1",
      worktree: paths.repo,
      status: "ready",
      ...extra,
    },
    env()
  );
  writeFileSync(
    join(paths.home, "tasks", id, "spec.md"),
    "# A task\n\n## Decisions\n\n- go\n"
  );
}

function cli(args: string[], extraEnv: object = {}) {
  const run = spawnSync(process.execPath, [COACH_SCRIPT, ...args], {
    env: { ...env(), ...extraEnv } as Record<string, string>,
    encoding: "utf8",
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

const lastJson = (stdout: string) => JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
const eventNames = () => readEvents(env()).map((e: { event: string }) => e.event);

startEachTestInAFreshFactory(import.meta.file);

describe("what the user changed after the factory (criterion 6)", () => {
  function pushedTask(withLaterCommit: boolean) {
    seedRepoWithRemote();
    commitFile(paths.repo, "feature.txt", "factory\n", "feat: factory work");
    git(paths.repo, "push", "-q", "origin", "factory/t1");
    const head = git(paths.repo, "rev-parse", "HEAD");
    seedTask("t1", { pr: "https://github.com/o/r/pull/7" });
    appendEvent({ event: "pushed", task: "t1", head }, env());
    if (withLaterCommit) {
      commitFile(paths.repo, "fix.txt", "user fix\n", "fix: the user corrected it");
      git(paths.repo, "push", "-q", "origin", "factory/t1");
    }
    return head;
  }

  test("a merged PR with a commit after the pushed head yields that commit's message and diff", () => {
    pushedTask(true);
    const [entry] = userCorrections(env());
    expect(entry.task).toBe("t1");
    expect(entry.commits).toHaveLength(1);
    expect(entry.commits[0].message).toContain("the user corrected it");
    expect(entry.commits[0].diff).toContain("user fix");
  });

  test("a merged PR with no commit after the pushed head is left out", () => {
    pushedTask(false);
    expect(userCorrections(env())).toEqual([]);
  });

  test("a PR that has not merged is left out", () => {
    pushedTask(true);
    paths.mergedAt = "";
    expect(userCorrections(env())).toEqual([]);
  });
});

describe("coach.mjs commands (criteria 10, 12)", () => {
  test("list groups pending findings by role, high severity first, with evidence counts", () => {
    writeFindings(
      [
        finding({ id: "c1", role: "debugger", severity: "low" }),
        finding({ id: "c2", role: "po", severity: "high", class: "b" }),
        finding({ id: "c3", role: "debugger", severity: "high", class: "c" }),
        finding({ id: "c4", role: "po", status: "rejected", class: "d" }),
      ],
      env()
    );
    const out = lastJson(cli(["list"]).stdout) as {
      role: string;
      findings: { id: string; evidenceCount: number }[];
    }[];
    expect(out.map((group) => group.role).sort()).toEqual(["debugger", "po"]);
    const debuggerGroup = out.find((group) => group.role === "debugger");
    expect(debuggerGroup?.findings.map((f) => f.id)).toEqual(["c3", "c1"]);
    expect(debuggerGroup?.findings[0]?.evidenceCount).toBe(1);
    expect(JSON.stringify(out)).not.toContain('"c4"');
    expect(listFindings(env())).toEqual(out);
  });

  test("show prints one finding", () => {
    writeFindings([finding()], env());
    expect(lastJson(cli(["show", "c1"]).stdout)).toMatchObject({
      id: "c1",
      role: "debugger",
    });
  });

  test("reject stores the reason and the status", () => {
    writeFindings([finding()], env());
    const run = cli(["reject", "c1", "too narrow"]);
    expect(run.status).toBe(0);
    expect(readFindings(env())[0]).toMatchObject({
      status: "rejected",
      rejectReason: "too narrow",
    });
  });

  test("approve --repo creates a small task with the rule, role file and metric, and builds nothing", () => {
    seedRepoWithRemote();
    writeFindings([finding()], env());
    const run = cli(["approve", "c1", "--repo", paths.repo]);
    expect(run.status).toBe(0);
    const { task, specPath } = lastJson(run.stdout);
    expect(readTask(task, env())).toMatchObject({ category: "small" });
    const spec = readFileSync(specPath, "utf8");
    expect(spec).toContain("Close the loop on every repro.");
    expect(spec).toContain("agents/debugger.md");
    expect(spec).toContain("fixRounds");
    expect(readFindings(env())[0]).toMatchObject({ status: "approved", taskId: task });
    expect(existsSync(paths.claudeLog)).toBe(false);
    expect(eventNames()).not.toContain("role_run");
  });

  test("approve for the po role also names the po skill", () => {
    seedRepoWithRemote();
    writeFindings([finding({ role: "po" })], env());
    const { specPath } = lastJson(cli(["approve", "c1", "--repo", paths.repo]).stdout);
    expect(readFileSync(specPath, "utf8")).toContain("skills/po/SKILL.md");
  });

  test("approve without --repo or coach.repo fails with exit 2 and creates no task", () => {
    writeFindings([finding()], env());
    const run = cli(["approve", "c1"]);
    expect(run.status).toBe(2);
    expect(lastJson(run.stdout).error).toContain("coach.repo");
    expect(readFindings(env())[0]?.status).toBe("pending");
  });

  test("approve takes the repo from coach.repo in config.json", () => {
    seedRepoWithRemote();
    writeFileSync(
      join(paths.home, "config.json"),
      JSON.stringify({ coach: { repo: paths.repo } })
    );
    writeFindings([finding()], env());
    expect(cli(["approve", "c1"]).status).toBe(0);
  });

  test("list --applied says 'not enough runs' with fewer than 3 runs after the merge", () => {
    paths.mergedAt = "2020-01-01T00:00:00Z";
    seedRepoWithRemote();
    seedTask("t9", { pr: "https://github.com/o/r/pull/9" });
    writeFindings([finding({ status: "approved", taskId: "t9" })], env());
    for (const task of ["r1", "r2"]) {
      appendEvent({ event: "task_started", task }, env());
      appendEvent({ event: "run_finished", task, costUsd: 1 }, env());
    }
    const [row] = lastJson(cli(["list", "--applied"]).stdout);
    expect(row).toMatchObject({ id: "c1", after: "not enough runs" });
    expect((appliedReport(env()) as unknown[])[0]).toMatchObject({
      after: "not enough runs",
    });
  });

  test("list --applied reports a number once 3 runs follow the merge", () => {
    paths.mergedAt = "2020-01-01T00:00:00Z";
    seedRepoWithRemote();
    seedTask("t9", { pr: "https://github.com/o/r/pull/9" });
    writeFindings(
      [finding({ status: "approved", taskId: "t9", metric: "costUsd" })],
      env()
    );
    for (const task of ["r1", "r2", "r3"]) {
      appendEvent({ event: "task_started", task }, env());
      appendEvent({ event: "run_finished", task, costUsd: 2 }, env());
    }
    const [row] = lastJson(cli(["list", "--applied"]).stdout);
    expect(row.after).toBe(2);
  });

  test("an unknown command exits 2 with usage", () => {
    const run = cli(["bogus"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("usage: coach.mjs");
  });
});

describe("running the coach on a task (criteria 1, 4)", () => {
  function seedFinishedRun() {
    seedRepoWithRemote();
    commitFile(paths.repo, "feature.txt", "work\n", "feat: work");
    seedTask("t1");
    for (const [role, sessionId] of [
      ["planner", "sess-a"],
      ["code-writer", "sess-b"],
    ]) {
      appendEvent(
        {
          event: "role_finished",
          task: "t1",
          role,
          sessionId,
          transcriptPath: `/transcripts/${sessionId}.jsonl`,
        },
        env()
      );
    }
    writeFileSync(join(paths.home, "tasks", "t1", "plan.md"), "# plan\n");
  }

  test("the instructions name the spec, events, artifacts and every transcript path", () => {
    seedFinishedRun();
    const result = runCoach("t1", { env: env(), now: NOW }) as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    const [call] = readFileSync(paths.claudeLog, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    for (const part of [
      join(paths.home, "tasks", "t1", "spec.md"),
      join(paths.home, "tasks", "t1", "events.jsonl"),
      join(paths.home, "tasks", "t1", "plan.md"),
      "/transcripts/sess-a.jsonl",
      "/transcripts/sess-b.jsonl",
      "Decisions",
    ]) {
      expect(call.stdin).toContain(part);
    }
    expect(call.stdin).not.toContain("design.md\n");
  });

  test("the result is stored and coach_finished carries the counts", () => {
    seedFinishedRun();
    replyWith({ findings: [coachResult()], updates: [] });
    runCoach("t1", { env: env(), now: NOW });
    expect(readFindings(env())).toHaveLength(1);
    const finished = readEvents(env()).find(
      (e: { event: string }) => e.event === "coach_finished"
    );
    expect(finished).toMatchObject({ task: "t1", created: 1, updated: 0 });
  });

  test("a rule naming a helper added in the run's diff is not stored", () => {
    seedFinishedRun();
    commitFile(
      paths.repo,
      "helper.mjs",
      "export function fetchWidgetRows() {}\n",
      "feat: helper"
    );
    replyWith({
      findings: [coachResult({ rule: "Never forget fetchWidgetRows." })],
      updates: [],
    });
    runCoach("t1", { env: env(), now: NOW });
    expect(readFindings(env())).toHaveLength(0);
    expect(eventNames()).toContain("coach_rule_rejected");
  });

  function seedCorrectedRun() {
    seedRepoWithRemote();
    commitFile(paths.repo, "feature.txt", "factory\n", "feat: factory work");
    git(paths.repo, "push", "-q", "origin", "factory/t1");
    seedTask("t1", { pr: "https://github.com/o/r/pull/7" });
    appendEvent(
      { event: "pushed", task: "t1", head: git(paths.repo, "rev-parse", "HEAD") },
      env()
    );
    commitFile(paths.repo, "fix.txt", "user fix\n", "fix: the user corrected it");
    git(paths.repo, "push", "-q", "origin", "factory/t1");
    return git(paths.repo, "rev-parse", "HEAD");
  }

  test("a run whose every rule is rejected leaves the user's correction for the next run", () => {
    seedCorrectedRun();
    replyWith({
      findings: [coachResult({ rule: "Always keep fix.txt." })],
      updates: [],
    });
    runCoach("t1", { env: env(), now: NOW });
    expect(eventNames()).toContain("coach_rule_rejected");
    expect(eventNames()).not.toContain("coach_corrections_given");
    expect(userCorrections(env())).toHaveLength(1);
  });

  test("a run that stores a finding marks the user's correction as given", () => {
    const sha = seedCorrectedRun();
    replyWith({
      findings: [coachResult()],
      updates: [],
      reviewed: [
        { source: sha, verdict: "finding", class: "spec reports", reason: "The fix." },
      ],
    });
    runCoach("t1", { env: env(), now: NOW });
    expect(eventNames()).toContain("coach_corrections_given");
    expect(userCorrections(env())).toEqual([]);
  });

  describe("resume and incomplete runs (criteria 3, 4, 5)", () => {
    const A = "/transcripts/sess-a.jsonl";
    const B = "/transcripts/sess-b.jsonl";
    const clean = (source: string) => ({
      source,
      verdict: "clean",
      reason: "Read it; nothing needs to change.",
    });
    const finishedEvent = () =>
      readEvents(env()).find((e: { event: string }) => e.event === "coach_finished");
    const incompleteEvents = () =>
      readEvents(env()).filter((e: { event: string }) => e.event === "coach_incomplete");

    test("a run that completes on resume merges both results", () => {
      seedFinishedRun();
      replyWith({
        findings: [coachResult()],
        updates: [],
        reviewed: [
          { source: A, verdict: "finding", class: "spec reports", reason: "Routed." },
        ],
      });
      resumeWith({
        findings: [coachResult({ class: "late checks", rule: "Check late." })],
        updates: [],
        reviewed: [
          { source: B, verdict: "finding", class: "late checks", reason: "Late." },
        ],
      });
      runCoach("t1", { env: env(), now: NOW });
      const calls = claudeCalls();
      expect(calls).toHaveLength(2);
      const argv = calls[1]?.argv ?? [];
      expect(argv.join(" ")).toContain("--resume sess-coach");
      expect(calls[1]?.stdin).toContain(B);
      expect(calls[1]?.stdin).not.toContain("sess-a");
      expect(
        readFindings(env())
          .map((f: { class: string }) => f.class)
          .sort()
      ).toEqual(["late checks", "spec reports"]);
      expect(incompleteEvents()).toEqual([]);
      expect(finishedEvent()).toMatchObject({ reviewed: 2, expected: 2 });
    });

    test("a run complete the first time makes one call and counts every input", () => {
      seedFinishedRun();
      replyWith({ findings: [], updates: [], reviewed: [clean(A), clean(B)] });
      runCoach("t1", { env: env(), now: NOW });
      expect(claudeCalls()).toHaveLength(1);
      expect(finishedEvent()).toMatchObject({ reviewed: 2, expected: 2 });
      expect(incompleteEvents()).toEqual([]);
    });

    test("inputs still missing after the resume are recorded and the findings kept", () => {
      seedFinishedRun();
      replyWith({
        findings: [coachResult()],
        updates: [],
        reviewed: [
          { source: A, verdict: "finding", class: "spec reports", reason: "Routed." },
        ],
      });
      runCoach("t1", { env: env(), now: NOW });
      expect(claudeCalls()).toHaveLength(2);
      const events = incompleteEvents();
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0]?.missing)).toContain(B);
      expect(JSON.stringify(events[0]?.missing)).not.toContain("sess-a");
      expect(readFindings(env())).toHaveLength(1);
      expect(finishedEvent()).toMatchObject({ reviewed: 1, expected: 2 });
    });

    test("a correction without a verdict is not marked given", () => {
      seedCorrectedRun();
      runCoach("t1", { env: env(), now: NOW });
      expect(incompleteEvents()).toHaveLength(1);
      expect(eventNames()).not.toContain("coach_corrections_given");
      expect(userCorrections(env())).toHaveLength(1);
    });
  });

  test("pending and rejected findings are handed to the coach", () => {
    seedFinishedRun();
    writeFindings(
      [
        finding({ id: "c1" }),
        finding({ id: "c2", class: "x", status: "rejected", rejectReason: "nope" }),
      ],
      env()
    );
    runCoach("t1", { env: env(), now: NOW });
    const [call] = readFileSync(paths.claudeLog, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(call.stdin).toContain("c1");
    expect(call.stdin).toContain("nope");
  });
});
