import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import {
  appliedReport,
  coachInstructions,
  listFindings,
  runCoach,
} from "../assets/plugins/dark-factory/scripts/coach.mjs";
import { userCorrections } from "../assets/plugins/dark-factory/scripts/corrections.mjs";
import {
  expectedInputs,
  missingInputs,
} from "../assets/plugins/dark-factory/scripts/coverage.mjs";
import {
  applyCoachResult,
  diffNames,
  generalityViolation,
  readFindings,
  writeFindings,
} from "../assets/plugins/dark-factory/scripts/findings.mjs";
import {
  appendEvent,
  readEvents,
  readTask,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { writeFakeBin } from "./fixtures/fake-bin";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const PLUGIN_ROOT = resolve(import.meta.dir, "../assets/plugins/dark-factory");
const COACH_SCRIPT = join(PLUGIN_ROOT, "scripts/coach.mjs");
const NOW = new Date("2026-10-20T12:00:00Z");
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

let root: string;
let home: string;
let bin: string;
let repo: string;
let claudeLog: string;
let claudeReply: string;
let claudeResumeReply: string;
let mergedAt: string;

const processEnvWithoutPath = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path")
  );

const env = () =>
  ({
    ...processEnvWithoutPath(),
    ...GIT_ENV,
    DARK_FACTORY_HOME: home,
    FAKE_CLAUDE_LOG: claudeLog,
    FAKE_CLAUDE_REPLY: claudeReply,
    FAKE_CLAUDE_RESUME_REPLY: claudeResumeReply,
    FAKE_MERGED_AT: mergedAt,
    PATH: [bin, process.env.PATH ?? ""].join(delimiter),
  }) as Record<string, string>;

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
  const remote = join(root, "remote.git");
  mkdirSync(repo, { recursive: true });
  git(root, "init", "-q", "--bare", "-b", "canary", remote);
  git(repo, "init", "-q", "-b", "canary");
  commitFile(repo, "README.md", "repo\n", "init");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "canary");
  git(repo, "checkout", "-q", "-b", "factory/t1");
}

function fakeBins() {
  mkdirSync(bin, { recursive: true });
  writeFakeBin(
    bin,
    "claude",
    [
      `const fs = require("node:fs");`,
      `const stdin = await Bun.stdin.text();`,
      `fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin }) + "\\n");`,
      `const resuming = process.argv.includes("--resume") && process.env.FAKE_CLAUDE_RESUME_REPLY;`,
      `const replyFile = resuming ? process.env.FAKE_CLAUDE_RESUME_REPLY : process.env.FAKE_CLAUDE_REPLY;`,
      `const structured = JSON.parse(fs.readFileSync(replyFile, "utf8"));`,
      `process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", session_id: "sess-coach", total_cost_usd: 0.1, num_turns: 1, duration_ms: 1, usage: {}, structured_output: structured }));`,
      "",
    ].join("\n")
  );
  writeFakeBin(
    bin,
    "gh",
    [
      `const args = process.argv.slice(2);`,
      `if (args[0] === "pr" && args[1] === "view") process.stdout.write(JSON.stringify({ mergedAt: process.env.FAKE_MERGED_AT }));`,
      `if (args[0] === "pr" && args[1] === "diff") process.stdout.write("");`,
      "",
    ].join("\n")
  );
}

function replyWith(result: object) {
  writeFileSync(claudeReply, JSON.stringify(result));
}

function resumeWith(result: object) {
  writeFileSync(claudeResumeReply, JSON.stringify(result));
}

function claudeCalls(): { argv: string[]; stdin: string }[] {
  return readFileSync(claudeLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function seedTask(id: string, extra: object = {}) {
  writeTask(
    {
      id,
      title: "A task",
      repo,
      category: "small",
      base: "canary",
      branch: "factory/t1",
      worktree: repo,
      status: "ready",
      ...extra,
    },
    env()
  );
  writeFileSync(join(home, "tasks", id, "spec.md"), "# A task\n\n## Decisions\n\n- go\n");
}

const finding = (over: object = {}) => ({
  id: "c1",
  status: "pending",
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  class: "open repro",
  role: "debugger",
  rule: "Close the loop on every repro.",
  severity: "medium",
  metric: "fixRounds",
  elsewhere: "task-x",
  evidence: [{ task: "t1", ref: "event gate" }],
  ...over,
});

const coachResult = (over: object = {}) => ({
  class: "spec reports",
  role: "po",
  rule: "State what to report, not where.",
  evidence: [{ task: "t1", ref: "event review" }],
  severity: "high",
  metric: "reviewFindings",
  elsewhere: "task-y",
  ...over,
});

const apply = (store: object[], result: object, names: string[] = []) =>
  applyCoachResult(store, result, { taskId: "t1", names, now: NOW }) as {
    store: Record<string, unknown>[];
    events: Record<string, unknown>[];
    created: string[];
    updated: string[];
  };

function cli(args: string[], extraEnv: object = {}) {
  const run = spawnSync(process.execPath, [COACH_SCRIPT, ...args], {
    env: { ...env(), ...extraEnv } as Record<string, string>,
    encoding: "utf8",
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

const lastJson = (stdout: string) => JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
const eventNames = () => readEvents(env()).map((e: { event: string }) => e.event);

beforeEach(() => {
  root = freshTestDir(import.meta.file);
  home = join(root, "factory");
  bin = join(root, "bin");
  repo = join(root, "repo");
  claudeLog = join(root, "claude.jsonl");
  claudeReply = join(root, "reply.json");
  claudeResumeReply = join(root, "resume.json");
  mergedAt = "2999-01-01T00:00:00Z";
  mkdirSync(home, { recursive: true });
  fakeBins();
  replyWith({ findings: [], updates: [] });
  resumeWith({ findings: [], updates: [], reviewed: [] });
});

describe("the findings store (criteria 7, 8)", () => {
  test("a new finding is stored pending with the fields and an id", () => {
    const { store, created } = apply([], { findings: [coachResult()], updates: [] });
    expect(created).toEqual(["c1"]);
    expect(store[0]).toMatchObject({
      id: "c1",
      status: "pending",
      class: "spec reports",
      role: "po",
      severity: "high",
      metric: "reviewFindings",
      evidence: [{ task: "t1", ref: "event review" }],
    });
    expect(store[0]?.createdAt).toBe(NOW.toISOString());
  });

  test("the store round-trips through findings.jsonl in the factory home", () => {
    writeFindings([finding()], env());
    expect(existsSync(join(home, "coach", "findings.jsonl"))).toBe(true);
    expect(readFindings(env())).toEqual([finding()]);
  });

  test("a same-class finding adds evidence to the pending one instead of duplicating", () => {
    const added = coachResult({
      class: " Open Repro ",
      role: "debugger",
      evidence: [{ task: "t2", ref: "commit abc" }],
    });
    const { store, updated, created } = apply([finding()], {
      findings: [added],
      updates: [],
    });
    expect(store).toHaveLength(1);
    expect(created).toEqual([]);
    expect(updated).toEqual(["c1"]);
    expect(store[0]?.evidence).toHaveLength(2);
  });

  test("an update by id adds evidence once, and an unknown id is recorded as ignored", () => {
    const evidence = [{ task: "t2", ref: "commit abc" }];
    const first = apply([finding()], {
      findings: [],
      updates: [
        { id: "c1", evidence },
        { id: "c1", evidence },
        { id: "c9", evidence },
      ],
    });
    expect(first.store[0]?.evidence).toHaveLength(2);
    expect(first.events).toEqual([
      { event: "coach_update_ignored", task: "t1", id: "c9" },
    ]);
  });

  test("a class the user rejected is dropped, not proposed again", () => {
    const rejected = finding({ status: "rejected", rejectReason: "too narrow" });
    const { store, events, created } = apply([rejected], {
      findings: [coachResult({ class: "open repro", role: "debugger" })],
      updates: [],
    });
    expect(store).toHaveLength(1);
    expect(created).toEqual([]);
    expect(events[0]).toMatchObject({
      event: "coach_finding_dropped",
      task: "t1",
      reason: "rejected",
      rejectedId: "c1",
    });
  });
});

describe("the generality check (criterion 9)", () => {
  const diff = [
    "--- a/src/lib/widgetRows.mjs",
    "+++ b/src/lib/widgetRows.mjs",
    "+export function fetchWidgetRows(db) {",
    "+  const row_count = 3;",
    "+}",
  ].join("\n");

  test("names come from changed paths, basenames and added identifiers", () => {
    const names = diffNames(diff);
    expect(names).toEqual(
      expect.arrayContaining([
        "src/lib/widgetRows.mjs",
        "widgetRows.mjs",
        "fetchWidgetRows",
      ])
    );
  });

  test("a rule naming a helper from the diff is rejected with the matched name", () => {
    const result = {
      findings: [coachResult({ rule: "Always call fetchWidgetRows before shipping." })],
      updates: [],
    };
    const { store, events, created } = apply([], result, diffNames(diff));
    expect(store).toHaveLength(0);
    expect(created).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        event: "coach_rule_rejected",
        task: "t1",
        matched: "fetchWidgetRows",
      }),
    ]);
  });

  test("a rule naming a changed file path is rejected too", () => {
    expect(
      generalityViolation("Edit src/lib/widgetRows.mjs first.", diffNames(diff))
    ).toBe("src/lib/widgetRows.mjs");
  });

  test("a plain lowercase key or variable from the diff does not block an ordinary word in a rule", () => {
    const keyed = [
      "+++ b/src/run.mjs",
      '+  appendEvent({ event: "x", task: taskId, body });',
      "+  const user = userPart(env);",
      '+  setup({ role: "reviewer" });',
    ].join("\n");
    const names = diffNames(keyed);
    expect(names).toEqual(["src/run.mjs", "run.mjs"]);
    expect(
      generalityViolation(
        "A role must check the task body before telling the user.",
        names
      )
    ).toBeNull();
  });

  test("a rule that names nothing from the diff is stored", () => {
    const result = { findings: [coachResult()], updates: [] };
    const { store, events } = apply([], result, diffNames(diff));
    expect(store).toHaveLength(1);
    expect(events).toEqual([]);
  });
});

describe("what the user changed after the factory (criterion 6)", () => {
  function pushedTask(withLaterCommit: boolean) {
    seedRepoWithRemote();
    commitFile(repo, "feature.txt", "factory\n", "feat: factory work");
    git(repo, "push", "-q", "origin", "factory/t1");
    const head = git(repo, "rev-parse", "HEAD");
    seedTask("t1", { pr: "https://github.com/o/r/pull/7" });
    appendEvent({ event: "pushed", task: "t1", head }, env());
    if (withLaterCommit) {
      commitFile(repo, "fix.txt", "user fix\n", "fix: the user corrected it");
      git(repo, "push", "-q", "origin", "factory/t1");
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
    mergedAt = "";
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
    const run = cli(["approve", "c1", "--repo", repo]);
    expect(run.status).toBe(0);
    const { task, specPath } = lastJson(run.stdout);
    expect(readTask(task, env())).toMatchObject({ category: "small" });
    const spec = readFileSync(specPath, "utf8");
    expect(spec).toContain("Close the loop on every repro.");
    expect(spec).toContain("agents/debugger.md");
    expect(spec).toContain("fixRounds");
    expect(readFindings(env())[0]).toMatchObject({ status: "approved", taskId: task });
    expect(existsSync(claudeLog)).toBe(false);
    expect(eventNames()).not.toContain("role_run");
  });

  test("approve for the po role also names the po skill", () => {
    seedRepoWithRemote();
    writeFindings([finding({ role: "po" })], env());
    const { specPath } = lastJson(cli(["approve", "c1", "--repo", repo]).stdout);
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
    writeFileSync(join(home, "config.json"), JSON.stringify({ coach: { repo } }));
    writeFindings([finding()], env());
    expect(cli(["approve", "c1"]).status).toBe(0);
  });

  test("list --applied says 'not enough runs' with fewer than 3 runs after the merge", () => {
    mergedAt = "2020-01-01T00:00:00Z";
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
    mergedAt = "2020-01-01T00:00:00Z";
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
    commitFile(repo, "feature.txt", "work\n", "feat: work");
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
    writeFileSync(join(home, "tasks", "t1", "plan.md"), "# plan\n");
  }

  test("the instructions name the spec, events, artifacts and every transcript path", () => {
    seedFinishedRun();
    const result = runCoach("t1", { env: env(), now: NOW }) as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    const [call] = readFileSync(claudeLog, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    for (const part of [
      join(home, "tasks", "t1", "spec.md"),
      join(home, "tasks", "t1", "events.jsonl"),
      join(home, "tasks", "t1", "plan.md"),
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
      repo,
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
    commitFile(repo, "feature.txt", "factory\n", "feat: factory work");
    git(repo, "push", "-q", "origin", "factory/t1");
    seedTask("t1", { pr: "https://github.com/o/r/pull/7" });
    appendEvent(
      { event: "pushed", task: "t1", head: git(repo, "rev-parse", "HEAD") },
      env()
    );
    commitFile(repo, "fix.txt", "user fix\n", "fix: the user corrected it");
    git(repo, "push", "-q", "origin", "factory/t1");
    return git(repo, "rev-parse", "HEAD");
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
    const [call] = readFileSync(claudeLog, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(call.stdin).toContain("c1");
    expect(call.stdin).toContain("nope");
  });

  test("coachInstructions is exported and returns text", () => {
    expect(typeof coachInstructions).toBe("function");
  });
});

describe("coverage of the coach's inputs (criterion 2)", () => {
  const transcripts = [{ path: "/t/a.jsonl" }, { path: "/t/b.jsonl" }];
  const corrections = [{ task: "t1", commits: [{ sha: "aaaa93c" }] }];
  const expected = expectedInputs(transcripts, corrections);
  const clean = (source: string) => ({ source, verdict: "clean", reason: "Checked." });
  const check = (reviewed: object[], knownClasses: string[] = []) =>
    missingInputs({ expected, reviewed, knownClasses });

  test("the inputs are every transcript path and every correction sha", () => {
    expect(expected).toEqual(["/t/a.jsonl", "/t/b.jsonl", "aaaa93c"]);
  });

  test("a complete result misses nothing", () => {
    expect(check(expected.map(clean))).toEqual([]);
  });

  test("a transcript with no verdict is missing", () => {
    const reviewed = [clean("/t/a.jsonl"), clean("aaaa93c")];
    expect(check(reviewed)).toEqual([{ source: "/t/b.jsonl", problem: "no verdict" }]);
  });

  test("a correction with no verdict is missing", () => {
    const reviewed = [clean("/t/a.jsonl"), clean("/t/b.jsonl")];
    expect(check(reviewed)).toEqual([{ source: "aaaa93c", problem: "no verdict" }]);
  });

  test("a finding verdict with an unknown class is missing", () => {
    const reviewed = [
      clean("/t/a.jsonl"),
      clean("/t/b.jsonl"),
      { source: "aaaa93c", verdict: "finding", class: "ghost", reason: "x" },
    ];
    expect(check(reviewed, ["other"])).toEqual([
      { source: "aaaa93c", problem: 'unknown class "ghost"' },
    ]);
  });

  test("a finding verdict naming a pending class, in any case, is accepted", () => {
    const reviewed = [
      clean("/t/a.jsonl"),
      clean("/t/b.jsonl"),
      { source: "aaaa93c", verdict: "finding", class: " Open Repro ", reason: "x" },
    ];
    expect(check(reviewed, ["open repro"])).toEqual([]);
  });
});

describe("agents/coach.md (criteria 3, 5, 13)", () => {
  const prompt = readFileSync(join(PLUGIN_ROOT, "agents/coach.md"), "utf8");

  test("it is an opus agent named coach", () => {
    expect(prompt).toContain("name: coach");
    expect(prompt).toContain("model: claude-opus-5-5");
  });

  test.each([
    "You change no files.",
    "Look for the cost and the mistakes, not only for failures: retries, escalations, denied tools, wasted turns, review and tester rounds, questions, and the user's corrections.",
    "The user's corrections after the factory are the strongest signal.",
    "Judge the PO too: whether the spec caused a mistake, such as a report routed to the PR body, or a criterion read as forbidding something it didn't.",
    "Propose only rules that would have prevented the mistake in a different task too, and name that task in elsewhere.",
    "Never name this task's files, helpers or variables in a rule.",
    "Prefer changing or removing an existing line of a role prompt over adding one, and propose consolidating a role prompt that has grown past 40 lines.",
    "Do not propose a class the user rejected. Add evidence to a pending finding of the same class through updates.",
    "Report nothing when the run was clean. An empty list is a valid result.",
  ])("it tells the coach: %s", (sentence) => {
    expect(prompt).toContain(sentence);
  });

  test.each([
    "Return a verdict in reviewed for every listed transcript and every listed correction, naming it by its path or sha exactly as listed: finding with the finding's class, or clean.",
    "A clean verdict needs a reason naming what you checked and why nothing needs to change.",
  ])("it requires a verdict for every input (criterion 6): %s", (sentence) => {
    expect(prompt).toContain(sentence);
  });
});

describe("the po skill and the readme (criteria 11, 14)", () => {
  const skill = readFileSync(join(PLUGIN_ROOT, "skills/po/SKILL.md"), "utf8");
  const readme = readFileSync(join(PLUGIN_ROOT, "README.md"), "utf8");

  test("the po skill has a Coach findings section with list, approve and the user's go", () => {
    expect(skill).toContain("## Coach findings");
    expect(skill).toContain("coach.mjs list");
    expect(skill).toContain("coach.mjs approve");
    expect(skill).toContain("Never approve or build a coach finding without the user.");
  });

  test("the readme describes the coach, the store, the commands and the approval flow", () => {
    expect(readme).toContain("## Coach");
    for (const part of [
      "findings.jsonl",
      "coach.mjs",
      "list --applied",
      "approve",
      "coach.repo",
      "coach_rule_rejected",
      "reviewed",
      "--resume",
      "coach_incomplete",
      "expected",
    ]) {
      expect(readme).toContain(part);
    }
  });
});
