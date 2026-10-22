import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { readEvents, writeTask } from "../assets/plugins/dark-factory/scripts/lib.mjs";
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

const COACH_POLL_MS = 5;

function waitForCoach() {
  const count = (name: string) => eventsNamed(name).length;
  const deadline = Date.now() + 60_000;
  while (
    count("coach_started") > count("coach_finished") + count("coach_failed") &&
    Date.now() < deadline
  ) {
    Bun.sleepSync(COACH_POLL_MS);
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

  test("an open pull request for the branch is adopted instead of a new one", () => {
    setup("small", { prList: JSON.stringify([{ url: ADOPTED_URL }]) });
    const run = runBuild();
    expect(resultOf(run)).toMatchObject({ status: "ready", pr: ADOPTED_URL });
    expect(ghCalls().some((call) => call.startsWith("pr create"))).toBe(false);
    expect(eventsNamed("pr_adopted")).toHaveLength(1);
  });
});

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
  test("no commit in the worktree is made by the orchestrator before the code writer", () => {
    setup("feature");
    runBuild();
    expect(calls().find((call) => call.role === "code-writer")?.status).not.toBe("");
    expect(git(ctx.worktree, "log", "--format=%s", "origin/canary..HEAD")).toBe(
      "feat: work"
    );
  });
});

describe("the config frozen by prepare", () => {
  const EXTRA_CHECK = { name: "extra", run: "test -f extra.txt" };
  const TWO_CHECKS = { ...DEFAULT_CONFIG, gate: [...DEFAULT_CONFIG.gate, EXTRA_CHECK] };
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
});
