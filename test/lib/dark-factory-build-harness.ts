import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { readEvents, writeTask } from "../../assets/plugins/dark-factory/scripts/lib.mjs";
import { writeFakeBin } from "../fixtures/fake-bin";
import { freshTestDir } from "./test-home";

export const PLUGIN_ROOT = resolve(import.meta.dir, "../../assets/plugins/dark-factory");
export const BUILD_SCRIPT = join(PLUGIN_ROOT, "scripts/build.mjs");
export const TASK = "t1";
export const PR_URL = "https://github.com/o/r/pull/7";
export const ADOPTED_URL = "https://github.com/o/r/pull/9";
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

export const NOOP = { write: {}, commit: false };
const NOISE = new Set([
  "role_finished",
  "role_settings",
  "gate_check",
  "handover",
  "plan_written",
  "unit_tests_done",
]);

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

export const ctx = {} as Context;

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
const cp = require("node:child_process");
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
if (group === "pr" && action === "view") process.stdout.write(JSON.stringify({ headRefOid: cp.execFileSync("git", ["rev-parse", "HEAD"]).toString().trim() }));
`;

export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);

  return result.stdout.trim();
}

export function buildEnv() {
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

export const DEFAULT_CONFIG = {
  baseBranch: "canary",
  gate: [{ name: "tests", run: TESTS_CHECK }],
};

export function setup(
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

export function setScenario(scenario: Scenario) {
  writeFileSync(ctx.scenario, JSON.stringify(scenario));
}

export function runBuild(taskId = TASK) {
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

export function resultOf(run: ReturnType<typeof runBuild>) {
  expect(run.lines).toHaveLength(1);

  return JSON.parse(run.lines[0] ?? "");
}

export const calls = (): Call[] =>
  existsSync(ctx.claudeLog)
    ? readFileSync(ctx.claudeLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

export const ghCalls = (): string[] =>
  existsSync(ctx.ghLog)
    ? readFileSync(ctx.ghLog, "utf8")
        .split("\n")
        .filter((line) => line && line !== "--version")
    : [];

const events = () =>
  readEvents({ DARK_FACTORY_HOME: ctx.factory }) as Record<string, unknown>[];

export const eventsNamed = (name: string) =>
  events().filter((event) => event.event === name);

const labelOf = (event: Record<string, unknown>) =>
  event.event === "role_run" ? `role:${event.role}` : String(event.event);

export const flow = () =>
  events()
    .map(labelOf)
    .filter((label) => !NOISE.has(label));

export const roleNames = () => calls().map((call) => call.role);
export const valueAfter = (argv: string[], flag: string) => {
  if (!argv.includes(flag)) throw new Error(`argv has no ${flag}`);

  return argv[argv.indexOf(flag) + 1] as string;
};
export const storedTask = () =>
  JSON.parse(readFileSync(join(ctx.factory, "tasks", TASK, "task.json"), "utf8"));
export const specText = () =>
  readFileSync(join(ctx.factory, "tasks", TASK, "spec.md"), "utf8");

export function useFreshContext(file: string) {
  const root = freshTestDir(file);
  Object.assign(ctx, {
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
  });
  mkdirSync(ctx.factory, { recursive: true });
}
