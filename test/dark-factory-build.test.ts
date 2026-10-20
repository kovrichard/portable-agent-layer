import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { readEvents, writeTask } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { FACTORY_MODELS } from "../src/tools/dark-factory/stamp";
import { writeFakeBin } from "./fixtures/fake-bin";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(90_000);

const PLUGIN_ROOT = resolve(import.meta.dir, "../assets/plugins/dark-factory");
const BUILD_SCRIPT = join(PLUGIN_ROOT, "scripts/build.mjs");
const TASK = "t1";
const PR_URL = "https://github.com/o/r/pull/7";
const ADOPTED_URL = "https://github.com/o/r/pull/9";
const TESTS_CHECK =
  "if [ -f feature.txt ]; then echo ' 3 pass'; exit 0; fi; echo ' 1 pass'; echo ' 2 fail'; exit 1";
const SPEC = "# Add export\n\n## Goal\n\nExport.\n\n## Decisions\n\n- start\n";

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

const NOOP = { write: {}, commit: false };
const NOISE = new Set(["role_finished", "gate_check"]);

type Step = {
  shell?: string;
  write?: Record<string, string>;
  commit?: boolean;
  reply?: object;
  exit?: number;
};

type Scenario = {
  roles?: Record<string, Step[]>;
  prList?: string;
  checks?: object[];
  checksError?: string;
};

type Context = {
  root: string;
  factory: string;
  repo: string;
  remote: string;
  bin: string;
  worktree: string;
  claudeLog: string;
  ghLog: string;
  scenario: string;
  notified: string;
};

type Call = {
  role: string;
  argv: string[];
  stdin: string;
  status: string;
};

let ctx: Context;

const FAKE_CLAUDE = `
const fs = require("node:fs");
const cp = require("node:child_process");
const scenario = JSON.parse(fs.readFileSync(process.env.FAKE_SCENARIO, "utf8"));
const argv = process.argv.slice(2);
const valueOf = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const role = valueOf("--agent").replace("dark-factory:", "");
const stdin = await Bun.stdin.text();
const log = process.env.FAKE_CLAUDE_LOG;
const before = fs.existsSync(log)
  ? fs.readFileSync(log, "utf8").split("\\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const index = before.filter((call) => call.role === role).length;
const status = cp.spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout;
fs.appendFileSync(log, JSON.stringify({ role, argv, stdin, status }) + "\\n");
const work = { write: { "feature.txt": "code" }, commit: true };
const defaults = {
  "test-writer": { write: { "feature.test.txt": "test" }, commit: false },
  "code-writer": work,
  debugger: work,
  reviewer: { reply: { findings: [] } },
  tester: { reply: { criteria: [] } },
  coach: { reply: { findings: [], updates: [] } },
  po: { reply: { answer: "ok" } },
};
const step = { reply: { done: true, summary: "done" }, ...(defaults[role] ?? {}), ...((scenario.roles?.[role] ?? [])[index] ?? {}) };
const run = (command, args) => cp.spawnSync(command, args, { encoding: "utf8" });
if (step.shell) run("sh", ["-c", step.shell]);
for (const [file, content] of Object.entries(step.write ?? {})) {
  const dir = require("node:path").dirname(file);
  if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, content);
}
if (step.commit) {
  run("git", ["add", "-A"]);
  run("git", ["commit", "-q", "-m", "feat: work"]);
}
process.stdout.write(JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "",
  session_id: valueOf("--resume") ?? "sess-" + role + "-" + (index + 1),
  total_cost_usd: 0.25,
  num_turns: 1,
  duration_ms: 5,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
  structured_output: step.reply,
}));
process.exit(step.exit ?? 0);
`;

const FAKE_GH = `
const fs = require("node:fs");
const scenario = JSON.parse(fs.readFileSync(process.env.FAKE_SCENARIO, "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, args.join(" ") + "\\n");
const [group, action] = args;
if (group === "pr" && action === "list") process.stdout.write(scenario.prList ?? "[]");
if (group === "pr" && action === "create") process.stdout.write("${PR_URL}\\n");
if (group === "pr" && action === "checks") {
  if (scenario.checksError) {
    process.stderr.write(scenario.checksError);
    process.exit(1);
  }
  const checks = scenario.checks ?? [{ name: "ci", bucket: "pass" }];
  process.stdout.write(JSON.stringify(checks));
  process.exit(checks.some((check) => check.bucket === "fail") ? 1 : 0);
}
`;

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function buildEnv() {
  return {
    ...process.env,
    ...GIT_ENV,
    DARK_FACTORY_HOME: ctx.factory,
    FAKE_SCENARIO: ctx.scenario,
    FAKE_CLAUDE_LOG: ctx.claudeLog,
    FAKE_GH_LOG: ctx.ghLog,
    DARK_FACTORY_NOTIFY: `cat > "${ctx.notified}"`,
    PATH: [ctx.bin, process.env.PATH ?? ""].join(delimiter),
  };
}

function seedRepo(config: object) {
  mkdirSync(ctx.repo, { recursive: true });
  git(ctx.root, "init", "-q", "--bare", "-b", "canary", ctx.remote);
  git(ctx.repo, "init", "-q", "-b", "canary");
  writeFileSync(join(ctx.repo, ".dark-factory.json"), JSON.stringify(config));
  writeFileSync(join(ctx.repo, "README.md"), "repo\n");
  git(ctx.repo, "add", "-A");
  git(ctx.repo, "commit", "-q", "-m", "init");
  git(ctx.repo, "remote", "add", "origin", ctx.remote);
  git(ctx.repo, "push", "-q", "origin", "canary");
}

function seedTask(category: string) {
  const env = buildEnv();
  writeTask(
    { id: TASK, title: "Add export", repo: ctx.repo, category, status: "draft" },
    env
  );
  writeFileSync(join(ctx.factory, "tasks", TASK, "spec.md"), SPEC);
}

const DEFAULT_CONFIG = {
  baseBranch: "canary",
  gate: [{ name: "tests", run: TESTS_CHECK }],
};

function setup(
  category: string,
  scenario: Scenario = {},
  config: object = DEFAULT_CONFIG
) {
  seedRepo(config);
  mkdirSync(ctx.bin, { recursive: true });
  writeFakeBin(ctx.bin, "claude", FAKE_CLAUDE);
  writeFakeBin(ctx.bin, "gh", FAKE_GH);
  seedTask(category);
  setScenario(scenario);
}

function setScenario(scenario: Scenario) {
  writeFileSync(ctx.scenario, JSON.stringify(scenario));
}

function runBuild(taskId = TASK) {
  const run = spawnSync(process.execPath, [BUILD_SCRIPT, taskId], {
    env: buildEnv() as Record<string, string>,
    encoding: "utf8",
  });
  waitForCoach();
  const lines = run.stdout.trim().split("\n").filter(Boolean);
  return { exitCode: run.status, stdout: run.stdout, stderr: run.stderr, lines };
}

function waitForCoach() {
  const count = (name: string) => eventsNamed(name).length;
  const deadline = Date.now() + 60_000;
  while (
    count("coach_started") > count("coach_finished") + count("coach_failed") &&
    Date.now() < deadline
  ) {
    Bun.sleepSync(100);
  }
}

function resultOf(run: ReturnType<typeof runBuild>) {
  expect(run.lines).toHaveLength(1);
  return JSON.parse(run.lines[0] ?? "");
}

const calls = (): Call[] =>
  existsSync(ctx.claudeLog)
    ? readFileSync(ctx.claudeLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

const ghCalls = (): string[] =>
  existsSync(ctx.ghLog)
    ? readFileSync(ctx.ghLog, "utf8")
        .split("\n")
        .filter((line) => line && line !== "--version")
    : [];

const events = () =>
  readEvents({ DARK_FACTORY_HOME: ctx.factory }) as Record<string, unknown>[];

const eventsNamed = (name: string) => events().filter((event) => event.event === name);

const labelOf = (event: Record<string, unknown>) =>
  event.event === "role_run" ? `role:${event.role}` : String(event.event);

const flow = () =>
  events()
    .map(labelOf)
    .filter((label) => !NOISE.has(label));

const roleNames = () => calls().map((call) => call.role);
const valueAfter = (argv: string[], flag: string) => {
  if (!argv.includes(flag)) throw new Error(`argv has no ${flag}`);
  return argv[argv.indexOf(flag) + 1] as string;
};
const modelOf = (call: Call) =>
  call.argv.includes("--model") ? valueAfter(call.argv, "--model") : undefined;
const storedTask = () =>
  JSON.parse(readFileSync(join(ctx.factory, "tasks", TASK, "task.json"), "utf8"));
const specText = () => readFileSync(join(ctx.factory, "tasks", TASK, "spec.md"), "utf8");

beforeEach(() => {
  const root = freshTestDir(import.meta.file);
  ctx = {
    root,
    factory: join(root, "factory"),
    repo: join(root, "repo"),
    remote: join(root, "remote.git"),
    bin: join(root, "bin"),
    worktree: join(root, "factory", "worktrees", TASK),
    claudeLog: join(root, "claude-calls.jsonl"),
    ghLog: join(root, "gh-calls.log"),
    scenario: join(root, "scenario.json"),
    notified: join(root, "notified.txt"),
  };
  mkdirSync(ctx.factory, { recursive: true });
});

describe("the coach at the end of a run", () => {
  const stuckScenario = {
    roles: { "code-writer": [NOOP, NOOP, NOOP, NOOP], debugger: [NOOP, NOOP] },
  };
  const waitingScenario = {
    roles: {
      "code-writer": [
        { ...NOOP, reply: { done: false, summary: "", question: "which file?" } },
      ],
      po: [{ reply: { userQuestion: "Which database?" } }],
    },
  };

  test("a ready run is coached after run_finished and records the counts", () => {
    setup("small");
    expect(runBuild().exitCode).toBe(0);
    expect(roleNames().at(-1)).toBe("coach");
    expect(flow().slice(-3)).toEqual(["run_finished", "coach_started", "coach_finished"]);
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

  test("a waiting run is not coached", () => {
    setup("small", waitingScenario);
    expect(runBuild().exitCode).toBe(3);
    expect(roleNames()).not.toContain("coach");
    expect(eventsNamed("coach_started")).toHaveLength(0);
    expect(eventsNamed("coach_finished")).toHaveLength(0);
  });

  test("the coach runs after the status is saved and the user is notified", () => {
    setup("small");
    runBuild();
    const labels = flow();
    expect(labels.indexOf("notify")).toBeLessThan(labels.indexOf("coach_started"));
    expect(labels.indexOf("task_status")).toBeLessThan(labels.indexOf("coach_started"));
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
  const root = freshTestDir(import.meta.file);
  ctx = {
    ...ctx,
    root,
    factory: join(root, "factory"),
    repo: join(root, "repo"),
    remote: join(root, "remote.git"),
    bin: join(root, "bin"),
    worktree: join(root, "factory", "worktrees", TASK),
    claudeLog: join(root, "claude-calls.jsonl"),
    ghLog: join(root, "gh-calls.log"),
    scenario: join(root, "scenario.json"),
    notified: join(root, "notified.txt"),
  };
  mkdirSync(ctx.factory, { recursive: true });
}

describe("a whole feature run", () => {
  test("runs the pipeline in order and ends ready with one JSON line and exit 0", () => {
    setup("feature");
    const run = runBuild();
    expect(run.exitCode).toBe(0);
    const result = resultOf(run);
    expect(Object.keys(result).sort()).toEqual(["message", "pr", "status", "task"]);
    expect(result).toMatchObject({ task: TASK, status: "ready", pr: PR_URL });
    expect(result.message).toContain(PR_URL);
    expect(roleNames()).toEqual([
      "planner",
      "test-writer",
      "code-writer",
      "reviewer",
      "tester",
      "coach",
    ]);
    expect(flow()).toEqual([
      "task_started",
      "role:planner",
      "role:test-writer",
      "tests_red",
      "role:code-writer",
      "gate",
      "role:reviewer",
      "review",
      "role:tester",
      "test",
      "sync",
      "pushed",
      "pr_opened",
      "ci",
      "pr_ready",
      "task_status",
      "notify",
      "run_finished",
      "coach_started",
      "coach_finished",
    ]);
    expect(ghCalls().some((call) => call.startsWith("pr ready"))).toBe(true);
    expect(storedTask()).toMatchObject({ status: "ready", pr: PR_URL });
  });

  test("a tier sets the model, and a role without a tier leaves it to its agent", () => {
    setup("feature");
    runBuild();
    const byRole = Object.fromEntries(calls().map((call) => [call.role, modelOf(call)]));
    expect(byRole).toEqual({
      planner: undefined,
      "test-writer": undefined,
      "code-writer": FACTORY_MODELS.small,
      reviewer: undefined,
      tester: undefined,
    });
  });

  test("every role runs isolated and gets its prompt as the only user message", () => {
    setup("feature");
    runBuild();
    expect(calls().length).toBeGreaterThan(0);
    for (const call of calls()) {
      expect(valueAfter(call.argv, "--setting-sources")).toBe("");
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

  test("the red test proof logs the exit code and the failing count", () => {
    setup("feature");
    runBuild();
    expect(eventsNamed("tests_red")).toEqual([
      expect.objectContaining({ task: TASK, exitCode: 1, failing: 2 }),
    ]);
  });

  test("the run ends with its totals summed from that run's role events", () => {
    setup("feature");
    runBuild();
    const finished = eventsNamed("run_finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      task: TASK,
      status: "ready",
      roleRuns: 5,
      costUsd: 1.25,
      tokens: 675,
    });
    expect(typeof finished[0]?.wallMs).toBe("number");
  });

  test("an open pull request for the branch is adopted instead of a new one", () => {
    setup("small", { prList: JSON.stringify([{ url: ADOPTED_URL }]) });
    const run = runBuild();
    expect(resultOf(run)).toMatchObject({ status: "ready", pr: ADOPTED_URL });
    expect(ghCalls().some((call) => call.startsWith("pr create"))).toBe(false);
    expect(eventsNamed("pr_adopted")).toHaveLength(1);
  });
});

describe("what the orchestrator runs itself", () => {
  test("it never spawns a process of its own, so claude only starts through role.mjs", () => {
    const source = readFileSync(BUILD_SCRIPT, "utf8");
    expect(source).not.toContain("child_process");
    expect(source).not.toMatch(/Bun\.spawn/);
    expect(source).toContain("role.mjs");
  });

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

  test("an unknown task is a stuck result, not a crash", () => {
    setup("small");
    const run = runBuild("no-such-task");
    expect(run.exitCode).toBe(1);
    expect(resultOf(run)).toMatchObject({ task: "no-such-task", status: "stuck" });
  });

  test("its tier models are the ones the factory stamps", async () => {
    const build = await import(BUILD_SCRIPT);
    expect(build.TIER_MODELS).toEqual(FACTORY_MODELS);
  });
});

describe("the code ladder", () => {
  test("climbs haiku twice, sonnet twice, then the debugger on opus", () => {
    setup("small", { roles: { "code-writer": [NOOP, NOOP, NOOP, NOOP] } });
    const run = runBuild();
    expect(run.exitCode).toBe(0);
    const coding = calls().slice(0, 5);
    expect(coding.map((call) => [call.role, modelOf(call)])).toEqual([
      ["code-writer", FACTORY_MODELS.small],
      ["code-writer", FACTORY_MODELS.small],
      ["code-writer", FACTORY_MODELS.medium],
      ["code-writer", FACTORY_MODELS.medium],
      ["debugger", FACTORY_MODELS.large],
    ]);
    expect(eventsNamed("escalation").map((event) => [event.from, event.to])).toEqual([
      ["code-writer:small", "code-writer:medium"],
      ["code-writer:medium", "debugger:large"],
    ]);
    expect(eventsNamed("gate").map((event) => event.result)).toEqual([
      "fail",
      "fail",
      "fail",
      "fail",
      "pass",
    ]);
  });

  test("the failing gate output goes to the next attempt", () => {
    setup("small", { roles: { "code-writer": [NOOP] } });
    runBuild();
    expect(calls()[1]?.stdin).toContain("The gate failed after the previous attempt");
    expect(calls()[1]?.stdin).toContain("2 fail");
  });

  test("six failed attempts end the run stuck, exit 1, with nothing shipped", () => {
    setup("small", {
      roles: { "code-writer": [NOOP, NOOP, NOOP, NOOP], debugger: [NOOP, NOOP] },
    });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    expect(resultOf(run)).toMatchObject({ status: "stuck", pr: null });
    expect(resultOf(run).message).toContain("gate still fails after 6 attempts");
    expect(roleNames()).toHaveLength(7);
    expect(roleNames().at(-1)).toBe("coach");
    expect(ghCalls()).toEqual([]);
    expect(storedTask().status).toBe("stuck");
  });
});

describe("review and test rounds", () => {
  test("a finding is fixed on the sonnet rung and the reviewer looks again", () => {
    setup("small", {
      roles: {
        reviewer: [
          { reply: { findings: [{ file: "a.ts", problem: "bad name", fix: "rename" }] } },
        ],
      },
    });
    const run = runBuild();
    expect(run.exitCode).toBe(0);
    expect(roleNames()).toEqual([
      "code-writer",
      "reviewer",
      "code-writer",
      "reviewer",
      "coach",
    ]);
    expect(modelOf(calls()[2] as Call)).toBe(FACTORY_MODELS.medium);
    expect(calls()[2]?.stdin).toContain("bad name");
    expect(eventsNamed("review").map((event) => event.findings)).toEqual([1, 0]);
  });

  test("the review stops after two rounds and the run still ships", () => {
    const findings = [{ file: "a.ts", problem: "bad name", fix: "rename" }];
    setup("small", {
      roles: { reviewer: [{ reply: { findings } }, { reply: { findings } }] },
    });
    const run = runBuild();
    expect(run.exitCode).toBe(0);
    expect(roleNames()).toEqual([
      "code-writer",
      "reviewer",
      "code-writer",
      "reviewer",
      "code-writer",
      "coach",
    ]);
  });

  test("a reviewer that fails is stuck, not read as no findings", () => {
    setup("small", { roles: { reviewer: [{ exit: 1, reply: {} }] } });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    expect(resultOf(run).message).toContain("reviewer failed");
    expect(ghCalls()).toEqual([]);
  });

  test("a diff that touches the UI adds the tester, and unmet criteria are fixed", () => {
    const config = { ...DEFAULT_CONFIG, uiPaths: ["ui/"] };
    setup(
      "small",
      {
        roles: {
          "code-writer": [{ write: { "feature.txt": "code", "ui/page.txt": "x" } }],
          tester: [
            {
              reply: {
                criteria: [{ criterion: "export works", met: false, evidence: "blank" }],
              },
            },
          ],
        },
      },
      config
    );
    const run = runBuild();
    expect(run.exitCode).toBe(0);
    expect(roleNames()).toEqual([
      "code-writer",
      "reviewer",
      "tester",
      "code-writer",
      "coach",
    ]);
    expect(eventsNamed("roles_added")).toEqual([
      expect.objectContaining({ task: TASK, role: "tester" }),
    ]);
    expect(eventsNamed("test")).toEqual([expect.objectContaining({ unmet: 1 })]);
    expect(modelOf(calls()[3] as Call)).toBe(FACTORY_MODELS.medium);
    expect(calls()[3]?.stdin).toContain("export works");
  });
});

describe("CI rounds", () => {
  test("a failing CI gets two fix rounds on the debugger and then ends stuck", () => {
    setup("small", { checks: [{ name: "ci", bucket: "fail" }] });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    expect(resultOf(run).message).toContain("CI still fails after 3 rounds");
    expect(roleNames()).toEqual([
      "code-writer",
      "reviewer",
      "debugger",
      "debugger",
      "coach",
    ]);
    expect(modelOf(calls()[2] as Call)).toBe(FACTORY_MODELS.large);
    expect(eventsNamed("ci")).toHaveLength(3);
    expect(eventsNamed("pushed")).toHaveLength(3);
  });

  test("CI that cannot be read ends stuck with the gh error and starts no fix round", () => {
    setup("small", { checksError: "HTTP 401: Bad credentials" });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    const result = resultOf(run);
    expect(result.status).toBe("stuck");
    expect(result.message).toContain("could not read CI");
    expect(result.message).toContain("HTTP 401");
    expect(roleNames()).toEqual(["code-writer", "reviewer", "coach"]);
  });
});

describe("syncing before the pull request", () => {
  test("a real conflict with the base is reported as one", () => {
    const other = join(ctx.root, "other");
    setup("small");
    const clash = `git clone -q "${ctx.remote}" "${other}" && cd "${other}" && echo theirs > feature.txt && git add -A && git commit -q -m other && git push -q origin canary`;
    setScenario({ roles: { "code-writer": [{ shell: clash }] } });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    expect(resultOf(run).message).toContain("conflicts with canary");
    expect(ghCalls()).toEqual([]);
  });

  test("a failed command is reported as that, never as a conflict", () => {
    setup("small");
    setScenario({
      roles: { "code-writer": [{ shell: `mv "${ctx.remote}" "${ctx.remote}.gone"` }] },
    });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    const message = resultOf(run).message as string;
    expect(message).toContain("sync failed");
    expect(message).not.toContain("conflicts with");
  });
});

describe("questions go to the PO and the role continues", () => {
  const question = { done: false, summary: "", question: "which file?" };

  test("the PO answers, the answer is recorded, and the same session resumes with it", () => {
    setup("small", {
      roles: {
        "code-writer": [{ ...NOOP, reply: question }],
        po: [{ reply: { answer: "use a.txt" } }],
      },
    });
    const run = runBuild();
    expect(run.exitCode).toBe(0);
    expect(roleNames()).toEqual([
      "code-writer",
      "po",
      "code-writer",
      "reviewer",
      "coach",
    ]);
    const [asked, po, resumed] = calls() as [Call, Call, Call];
    expect(po.stdin).toContain("which file?");
    expect(po.stdin).toContain(join(ctx.factory, "tasks", TASK, "spec.md"));
    expect(valueAfter(resumed.argv, "--resume")).toBe("sess-code-writer-1");
    expect(resumed.stdin).toContain("use a.txt");
    expect(asked.argv).not.toContain("--resume");
    expect(specText()).toMatch(/^- .*code-writer.*which file\?.*use a\.txt.*$/m);
    expect(eventsNamed("po_question")).toEqual([
      expect.objectContaining({ role: "code-writer", toUser: false }),
    ]);
  });

  test("a question only the user can answer parks the task as waiting with exit 3", () => {
    setup("small", {
      roles: {
        "code-writer": [{ ...NOOP, reply: question }],
        po: [{ reply: { userQuestion: "Which database?" } }],
      },
    });
    const run = runBuild();
    expect(run.exitCode).toBe(3);
    expect(resultOf(run)).toMatchObject({
      status: "waiting",
      message: "Which database?",
    });
    expect(roleNames()).toEqual(["code-writer", "po"]);
    expect(storedTask()).toMatchObject({ status: "waiting", note: "Which database?" });
    expect(readFileSync(ctx.notified, "utf8")).toContain("Which database?");
    expect(eventsNamed("question_to_user")).toHaveLength(1);
  });

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

describe("red tests", () => {
  test("tests that already pass are stuck, since they prove nothing", () => {
    setup("feature", {
      roles: { "test-writer": [{ write: { "feature.txt": "already" } }] },
    });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    expect(resultOf(run).message).toContain("the new tests pass before the code exists");
    expect(eventsNamed("tests_red")).toEqual([expect.objectContaining({ exitCode: 0 })]);
    expect(roleNames()).toEqual(["planner", "test-writer", "coach"]);
  });

  test("a gate with no check named tests is stuck with a message that says so", () => {
    setup("feature", {}, { baseBranch: "canary", gate: [{ name: "lint", run: "true" }] });
    const run = runBuild();
    expect(run.exitCode).toBe(1);
    expect(resultOf(run).message).toContain('no check named "tests"');
    expect(roleNames()).toEqual(["planner", "test-writer", "coach"]);
  });

  test("no commit in the worktree is made by the orchestrator before the code writer", () => {
    setup("feature");
    runBuild();
    expect(calls().find((call) => call.role === "code-writer")?.status).not.toBe("");
    expect(git(ctx.worktree, "log", "--format=%s", "origin/canary..HEAD")).toBe(
      "feat: work"
    );
  });
});

describe("failingTestCount", () => {
  const count = async (output: string) =>
    (await import(BUILD_SCRIPT)).failingTestCount(output);

  test("reads bun, jest and vitest summaries", async () => {
    expect(await count(" 5 pass\n 3 fail\nRan 8 tests")).toBe(3);
    expect(await count("Tests:       2 failed, 5 passed, 7 total")).toBe(2);
    expect(await count(" Tests  1 failed | 4 passed (5)")).toBe(1);
  });

  test("the last summary line wins", async () => {
    expect(await count("1 fail\nmore output\n4 fail")).toBe(4);
  });

  test("a runner it does not know gives null", async () => {
    expect(await count("all done")).toBeNull();
  });
});

describe("runTotals", () => {
  const finished = (extra: object) => ({
    event: "role_finished",
    task: TASK,
    ts: "2026-10-20T10:00:05.000Z",
    costUsd: 0.5,
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    ...extra,
  });

  test("sums this task's role runs since the run started, treating nulls as zero", async () => {
    const { runTotals } = await import(BUILD_SCRIPT);
    const totals = runTotals(
      [
        finished({}),
        finished({ costUsd: null, inputTokens: null }),
        finished({ ts: "2026-10-20T09:00:00.000Z" }),
        finished({ task: "other" }),
        { event: "gate", task: TASK, ts: "2026-10-20T10:00:06.000Z" },
      ],
      TASK,
      "2026-10-20T10:00:00.000Z"
    );
    expect(totals).toEqual({ costUsd: 0.5, tokens: 19, roleRuns: 2 });
  });
});

describe("the config frozen by prepare", () => {
  const EXTRA_CHECK = { name: "extra", run: "test -f extra.txt" };
  const TWO_CHECKS = { ...DEFAULT_CONFIG, gate: [...DEFAULT_CONFIG.gate, EXTRA_CHECK] };
  const weaken = (config: object) => ({
    write: { "feature.txt": "code", ".dark-factory.json": JSON.stringify(config) },
    commit: true,
  });
  const gateCheckNames = () => eventsNamed("gate_check").map((event) => event.check);

  test("prepare stores the checkout's config in task.json", () => {
    setup("small", {}, TWO_CHECKS);
    runBuild();
    expect(storedTask().config).toEqual(TWO_CHECKS);
  });

  test("a rerun stores the config as it is in the checkout now", () => {
    const question = { done: false, summary: "", question: "which file?" };
    setup("small", {
      roles: {
        "code-writer": [{ ...NOOP, reply: question }],
        po: [{ reply: { userQuestion: "Which database?" } }],
      },
    });
    expect(runBuild().exitCode).toBe(3);
    expect(storedTask().config).toEqual(DEFAULT_CONFIG);
    writeFileSync(join(ctx.repo, ".dark-factory.json"), JSON.stringify(TWO_CHECKS));
    writeFileSync(
      join(ctx.factory, "tasks", TASK, "spec.md"),
      `${specText()}- Rico: use postgres\n`
    );
    setScenario({
      roles: { "code-writer": [{ write: { "extra.txt": "x" }, commit: true }] },
    });
    runBuild();
    expect(storedTask().config).toEqual(TWO_CHECKS);
  });

  test("a task started before this change, with no config, gets one on the next prepare", () => {
    setup("small");
    expect(storedTask().config).toBeUndefined();
    const run = runBuild();
    expect(resultOf(run).status).toBe("ready");
    expect(storedTask().config).toEqual(DEFAULT_CONFIG);
  });

  test("a role deleting a gate check from the worktree's config does not weaken the gate", () => {
    setup("small", { roles: { "code-writer": [weaken(DEFAULT_CONFIG)] } }, TWO_CHECKS);
    runBuild();
    expect(eventsNamed("gate")[0]?.result).toBe("fail");
    expect(gateCheckNames().slice(0, 2)).toEqual(["tests", "extra"]);
    expect(eventsNamed("gate").every((event) => event.result === "fail")).toBe(true);
  });

  test("a config that is not on the base branch still drives the gate", () => {
    setup("feature");
    git(ctx.repo, "rm", "-q", "--cached", ".dark-factory.json");
    git(ctx.repo, "commit", "-q", "-m", "untrack config");
    git(ctx.repo, "push", "-q", "origin", "canary");
    const run = runBuild();
    expect(resultOf(run).status).toBe("ready");
    expect(eventsNamed("tests_red")).toHaveLength(1);
    expect(gateCheckNames()).toContain("tests");
    expect(eventsNamed("gate").at(-1)?.result).toBe("pass");
  });

  test("the red-test proof uses the frozen config, not the worktree's", () => {
    setup("feature", {
      roles: {
        "test-writer": [
          {
            write: {
              "feature.test.txt": "test",
              ".dark-factory.json": JSON.stringify({
                ...DEFAULT_CONFIG,
                gate: [{ name: "tests", run: "echo ' 1 pass'" }],
              }),
            },
            commit: false,
          },
        ],
      },
    });
    runBuild();
    expect(eventsNamed("tests_red")).toEqual([
      expect.objectContaining({ exitCode: 1, failing: 2 }),
    ]);
  });

  test("the red-test proof still finds its check when the worktree's config loses it", () => {
    setup("feature", {
      roles: {
        "test-writer": [
          {
            write: {
              "feature.test.txt": "test",
              ".dark-factory.json": JSON.stringify({ ...DEFAULT_CONFIG, gate: [] }),
            },
            commit: false,
          },
        ],
      },
    });
    const run = runBuild();
    expect(resultOf(run).message).not.toContain('no check named "tests"');
    expect(eventsNamed("tests_red")).toHaveLength(1);
  });

  test("the roles after the diff use the frozen uiPaths, not the worktree's", () => {
    const config = { ...DEFAULT_CONFIG, uiPaths: ["ui/"] };
    setup(
      "small",
      {
        roles: {
          "code-writer": [
            {
              write: {
                "feature.txt": "code",
                "ui/page.txt": "x",
                ".dark-factory.json": JSON.stringify(DEFAULT_CONFIG),
              },
              commit: true,
            },
          ],
        },
      },
      config
    );
    runBuild();
    expect(roleNames()).toContain("tester");
    expect(eventsNamed("roles_added")).toEqual([
      expect.objectContaining({ task: TASK, role: "tester" }),
    ]);
  });
});

describe("the reviewer is told when the config changes", () => {
  const reviewerStdin = () => calls().find((call) => call.role === "reviewer")?.stdin;

  test("a diff that touches .dark-factory.json is flagged in the reviewer's instructions", () => {
    setup("small", {
      roles: {
        "code-writer": [
          {
            write: {
              "feature.txt": "code",
              ".dark-factory.json": JSON.stringify({ ...DEFAULT_CONFIG, uiPaths: [] }),
            },
            commit: true,
          },
        ],
      },
    });
    runBuild();
    const text = reviewerStdin() ?? "";
    expect(text).toContain(".dark-factory.json");
    expect(text).toMatch(/finding/i);
  });

  test("a diff that does not touch it carries no such note", () => {
    setup("small");
    runBuild();
    expect(reviewerStdin()).toBeDefined();
    expect(reviewerStdin()).not.toContain(".dark-factory.json");
  });
});
