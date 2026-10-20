import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import {
  readEvents,
  readTask,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import {
  claudeInvocation,
  DEFAULT_TIMEOUT_MS,
  parseCliArgs,
  runRoleHeadless,
} from "../assets/plugins/dark-factory/scripts/role.mjs";
import { ROLE_POLICIES } from "../assets/plugins/dark-factory/scripts/roles.mjs";
import { writeFakeBin } from "./fixtures/fake-bin";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const PLUGIN_ROOT = resolve(import.meta.dir, "../assets/plugins/dark-factory");
const ROLE_SCRIPT = join(PLUGIN_ROOT, "scripts/role.mjs");
const SUCCESS = resolve(import.meta.dir, "fixtures/claude-print-success.json");
const BUDGET = resolve(import.meta.dir, "fixtures/claude-print-budget.json");

let home: string;
let worktree: string;
let bin: string;
let record: string;

function envWith(...dirs: string[]) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path")
  );
  return {
    ...base,
    DARK_FACTORY_HOME: home,
    PATH: [...dirs, process.env.PATH ?? process.env.Path ?? ""].join(delimiter),
  };
}

function envWithOnly(dir: string) {
  return { ...envWith(), PATH: dir };
}

type FakeClaude = {
  replyFile?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  sleepMs?: number;
};

function fakeClaude({
  replyFile,
  stdout = "",
  stderr = "",
  exitCode = 0,
  sleepMs = 0,
}: FakeClaude) {
  const reply = replyFile
    ? `fs.readFileSync(${JSON.stringify(replyFile)}, "utf8")`
    : JSON.stringify(stdout);
  const logic = [
    `const fs = require("node:fs");`,
    `fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin: await Bun.stdin.text() }));`,
    sleepMs ? `await Bun.sleep(${sleepMs});` : "",
    `process.stderr.write(${JSON.stringify(stderr)});`,
    `process.stdout.write(${reply});`,
    `process.exit(${exitCode});`,
    "",
  ].join("\n");
  writeFakeBin(bin, "claude", logic);
}

const recorded = () => JSON.parse(readFileSync(record, "utf8"));
const finishedEvents = () =>
  readEvents(envWith(bin)).filter((e: { event: string }) => e.event === "role_finished");
const valueAfter = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];
const listAfter = (argv: string[], flag: string) => valueAfter(argv, flag).split(",");

const NULL_STATS = {
  model: null,
  costUsd: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  turns: null,
  durationMs: null,
  sessionId: null,
};

const SUCCESS_STATS = {
  model: "claude-haiku-5-5",
  costUsd: 0.0015017700000000001,
  inputTokens: 2,
  outputTokens: 4,
  cacheReadTokens: 11697,
  cacheCreationTokens: 6913,
  turns: 1,
  durationMs: 917,
  sessionId: "ed384031-1d91-4aa5-9c15-a2ccd89d497c",
};

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  worktree = join(home, "worktree");
  bin = join(home, "bin");
  record = join(home, "claude-call.json");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeTask(
    {
      id: "t1",
      title: "Fix login",
      repo: home,
      category: "small",
      base: "canary",
      branch: "factory/t1",
      worktree,
    },
    envWith(bin)
  );
});

describe("invocation", () => {
  test("a reviewer runs headless in the worktree, read-only, with the task in the prompt", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    const { argv, cwd, stdin } = recorded();
    expect(argv.slice(0, 5)).toEqual([
      "-p",
      "--agent",
      "dark-factory:reviewer",
      "--output-format",
      "json",
    ]);
    expect(realpathSync(cwd)).toBe(realpathSync(worktree));
    expect(valueAfter(argv, "--permission-mode")).toBe("dontAsk");
    expect(listAfter(argv, "--disallowedTools")).toEqual(
      expect.arrayContaining(["Edit", "Write", "NotebookEdit"])
    );
    const allowed = listAfter(argv, "--allowedTools");
    expect(allowed).not.toContain("Bash");
    for (const rule of allowed.filter((entry) => entry.startsWith("Bash"))) {
      expect(rule).toMatch(/^Bash\((git|gh) /);
    }
    for (const part of [
      "t1",
      join(home, "tasks", "t1", "spec.md"),
      worktree,
      "factory/t1",
      "canary",
    ]) {
      expect(stdin).toContain(part);
    }
    expect(stdin).not.toContain("[Workflow harness");
  });

  test("a reviewer cannot write files through git output flags", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    expect(listAfter(recorded().argv, "--disallowedTools")).toEqual(
      expect.arrayContaining([
        "Bash(git diff *--output*)",
        "Bash(git log *--output*)",
        "Bash(git show *--output*)",
        "Bash(git diff *--ext-diff*)",
      ])
    );
  });

  test("a role that writes code gets Edit, Write and Bash and no deny list", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "code-writer", { env: envWith(bin) });
    const { argv } = recorded();
    expect(listAfter(argv, "--allowedTools")).toEqual(
      expect.arrayContaining(["Edit", "Write", "Bash"])
    );
    expect(argv).not.toContain("--disallowedTools");
  });

  test("the spending cap defaults per role and can be overridden", () => {
    const env = envWith(bin);
    const task = readTask("t1", env);
    const byDefault = claudeInvocation(task, "reviewer", { env }).args;
    expect(valueAfter(byDefault, "--max-budget-usd")).toBe(
      String(ROLE_POLICIES.reviewer.budgetUsd)
    );
    const overridden = claudeInvocation(task, "reviewer", { budgetUsd: 0.5, env }).args;
    expect(valueAfter(overridden, "--max-budget-usd")).toBe("0.5");
  });

  test("no argument holds a newline or a double quote, and the prompt is not in argv", () => {
    const env = envWith(bin);
    const task = readTask("t1", env);
    for (const role of Object.keys(ROLE_POLICIES)) {
      const { args, prompt } = claudeInvocation(task, role, { env });
      for (const arg of args) {
        expect(arg).not.toContain("\n");
        expect(arg).not.toContain('"');
        expect(arg).not.toBe(prompt);
      }
    }
  });

  test("every agent file has a tool policy", () => {
    const agents = readdirSync(join(PLUGIN_ROOT, "agents"))
      .map((file) => file.replace(/\.md$/, ""))
      .sort();
    expect(Object.keys(ROLE_POLICIES).sort()).toEqual(agents);
  });
});

describe("reply", () => {
  test("a recorded claude -p reply parses into the stat fields", () => {
    fakeClaude({ replyFile: SUCCESS });
    const outcome = runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    expect(outcome).toEqual({
      task: "t1",
      role: "reviewer",
      ...SUCCESS_STATS,
      exitCode: 0,
      result: "ok",
      error: null,
    });
  });

  test("a field the reply lacks is null, never invented", () => {
    fakeClaude({ stdout: '{"type":"result","is_error":false,"result":"ok"}' });
    const outcome = runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    expect(outcome).toEqual({
      task: "t1",
      role: "reviewer",
      ...NULL_STATS,
      exitCode: 0,
      result: "ok",
      error: null,
    });
  });
});

describe("failures", () => {
  test("a budget stop ends non-zero with the budget error and the real tokens", () => {
    fakeClaude({ replyFile: BUDGET, exitCode: 1 });
    const outcome = runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.error).toContain("Reached maximum budget");
    expect(outcome.costUsd).toBe(0.00094794);
    expect(outcome.inputTokens).toBe(2);
    expect(outcome.cacheReadTokens).toBe(14614);
  });

  test("a run past the wall-clock timeout is stopped with a clear error", () => {
    fakeClaude({ replyFile: SUCCESS, sleepMs: 5000 });
    const started = Date.now();
    const outcome = runRoleHeadless("t1", "reviewer", {
      env: envWith(bin),
      timeoutMs: 300,
    });
    expect(outcome.exitCode).toBe(124);
    expect(outcome.error).toContain("did not finish within 300 ms");
    expect(Date.now() - started).toBeLessThan(SPAWN_HEAVY_TEST_MS);
  });

  test("a non-zero exit with no JSON reports the code and stderr", () => {
    fakeClaude({ stdout: "", stderr: "boom", exitCode: 3 });
    const outcome = runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.error).toContain("exited with code 3");
    expect(outcome.error).toContain("boom");
  });

  test("output that is not JSON is an error even on exit 0", () => {
    fakeClaude({ stdout: "not json", exitCode: 0 });
    const outcome = runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.error).toContain("printed no JSON");
  });

  test("a missing claude binary yields the object, not a throw", () => {
    const empty = join(home, "empty");
    mkdirSync(empty, { recursive: true });
    const outcome = runRoleHeadless("t1", "reviewer", { env: envWithOnly(empty) });
    expect(outcome.exitCode).toBe(127);
    expect(outcome.error).toContain("claude is not installed");
  });

  test("an unknown role yields the object, not a throw", () => {
    fakeClaude({ replyFile: SUCCESS });
    const outcome = runRoleHeadless("t1", "intern", { env: envWith(bin) });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.error).toContain('unknown role "intern"');
  });
});

describe("event", () => {
  test("a finished run appends one role_finished event with the stats and no result", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    const events = finishedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      task: "t1",
      role: "reviewer",
      ...SUCCESS_STATS,
      exitCode: 0,
      error: null,
    });
    expect(typeof events[0].ts).toBe("string");
    expect(events[0]).not.toHaveProperty("result");
  });

  test("a failed run also appends exactly one event, with its error", () => {
    fakeClaude({ stdout: "not json", exitCode: 0 });
    runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    const events = finishedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].error).toContain("printed no JSON");
  });
});

describe("cli", () => {
  test("prints exactly one JSON line and exits with its exitCode", () => {
    fakeClaude({ replyFile: SUCCESS });
    const run = spawnSync(process.execPath, [ROLE_SCRIPT, "t1", "reviewer"], {
      env: envWith(bin),
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    const lines = run.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).exitCode).toBe(0);
  });

  test("a call with no task or role prints a usage error, not a stack trace", () => {
    const run = spawnSync(process.execPath, [ROLE_SCRIPT], {
      env: envWith(bin),
      encoding: "utf8",
    });
    expect(run.status).toBe(2);
    expect(JSON.parse(run.stdout.trim()).error).toMatch(/^usage: role\.mjs/);
    expect(run.stderr).not.toMatch(/\n\s+at /);
  });

  test("parses the budget, the timeout and the pass-through arguments", () => {
    expect(
      parseCliArgs([
        "t1",
        "reviewer",
        "--max-budget-usd",
        "1.5",
        "--timeout-ms",
        "1000",
        "--",
        "--plugin-dir",
        "/p",
      ])
    ).toEqual({
      taskId: "t1",
      role: "reviewer",
      budgetUsd: 1.5,
      timeoutMs: 1000,
      extraArgs: ["--plugin-dir", "/p"],
    });
    expect(() => parseCliArgs(["t1", "reviewer", "--max-budget-usd", "0"])).toThrow(
      "--max-budget-usd needs a positive number"
    );
    expect(DEFAULT_TIMEOUT_MS).toBe(1800000);
  });
});
