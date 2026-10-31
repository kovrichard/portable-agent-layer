import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";
import {
  readEvents,
  readTask,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import * as roleModule from "../assets/plugins/dark-factory/scripts/role.mjs";
import {
  DEFAULT_TIMEOUT_MS,
  parseCliArgs,
} from "../assets/plugins/dark-factory/scripts/role.mjs";
import { ROLE_POLICIES } from "../assets/plugins/dark-factory/scripts/roles.mjs";
import { writeFakeBin } from "./fixtures/fake-bin";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

type Options = Record<string, unknown>;
type Outcome = Record<string, unknown> & { exitCode: number; error: string | null };
type Invocation = { args: string[]; prompt: string; command: string; cwd: string };
const roleApi = roleModule as unknown as {
  runRoleHeadless: (taskId: string, role: string, options?: Options) => Outcome;
  claudeInvocation: (task: unknown, role: string, options?: Options) => Invocation;
};
const runRoleHeadless = roleApi.runRoleHeadless;
const claudeInvocation = roleApi.claudeInvocation;

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
const valueAfter = (argv: string[], flag: string) => {
  if (!argv.includes(flag)) throw new Error(`argv has no ${flag}`);
  return argv[argv.indexOf(flag) + 1] as string;
};
const listAfter = (argv: string[], flag: string) => valueAfter(argv, flag).split(",");

const ONE_COMMAND_SENTENCE =
  "Run one command per Bash call, with no &&, ; or pipes, so every call matches the tools you are allowed.";
const STRUCTURED = { done: true, summary: "ok" };

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

  test("the coach is read-only, reads the factory home and has the highest budget", () => {
    const env = envWith(bin);
    const task = readTask("t1", env);
    const { args } = claudeInvocation(task, "coach", { env });
    expect(args).toContain(home);
    expect(args[args.indexOf(home) - 1]).toBe("--add-dir");
    const allowed = listAfter(args, "--allowedTools");
    expect(allowed).not.toContain("Edit");
    expect(allowed).not.toContain("Write");
    expect(listAfter(args, "--disallowedTools")).toEqual(
      expect.arrayContaining(["Edit", "Write"])
    );
    const others = Object.entries(ROLE_POLICIES).filter(([role]) => role !== "coach");
    for (const [, policy] of others) {
      expect(ROLE_POLICIES.coach.budgetUsd).toBeGreaterThan(policy.budgetUsd);
    }
  });

  test("a transcript path is recorded only when the session file exists", () => {
    const env = { ...envWith(bin), HOME: home, USERPROFILE: home } as Record<
      string,
      string
    >;
    delete env.CLAUDE_CONFIG_DIR;
    const slug = worktree.replace(/[^a-zA-Z0-9]/g, "-");
    const transcriptPathFor = (
      roleModule as unknown as Record<string, (...args: never) => unknown>
    ).transcriptPathFor as (w: string, s: string | null, e: object) => string | null;
    expect(transcriptPathFor(worktree, "sess-1", env)).toBeNull();
    const file = join(home, ".claude", "projects", slug, "sess-1.jsonl");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "{}\n");
    expect(transcriptPathFor(worktree, "sess-1", env)).toBe(file);
    expect(transcriptPathFor(worktree, null, env)).toBeNull();
  });

  test("role_finished carries transcriptPath, null when there is no session file", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    const [finished] = finishedEvents();
    expect(finished).toHaveProperty("transcriptPath");
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
      args.forEach((arg: string, index: number) => {
        const isSchema = args[index - 1] === "--json-schema";
        expect(arg).not.toContain("\n");
        if (!isSchema) expect(arg).not.toContain('"');
        expect(arg).not.toBe(prompt);
      });
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
      transcriptPath: null,
      exitCode: 0,
      result: "ok",
      structured: STRUCTURED,
      error: null,
    });
  });

  test("a field the reply lacks is null, never invented", () => {
    fakeClaude({
      stdout: JSON.stringify({
        type: "result",
        is_error: false,
        result: "ok",
        structured_output: STRUCTURED,
      }),
    });
    const outcome = runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    expect(outcome).toEqual({
      task: "t1",
      role: "reviewer",
      ...NULL_STATS,
      transcriptPath: null,
      exitCode: 0,
      result: "ok",
      structured: STRUCTURED,
      error: null,
    });
  });

  test("a reply without structured_output is a failure, and the text result is never parsed instead", () => {
    fakeClaude({
      stdout: JSON.stringify({
        type: "result",
        is_error: false,
        result: '{"done":true,"summary":"from text"}',
      }),
    });
    const outcome = runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.error).toContain("no structured output");
    expect(outcome.structured).toBeNull();
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
  test("a finished run appends one role_finished event with the stats and no result or structured body", () => {
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
    expect(events[0]).not.toHaveProperty("structured");
  });

  test("a failed run also appends exactly one event, with its error", () => {
    fakeClaude({ stdout: "not json", exitCode: 0 });
    runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    const events = finishedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].error).toContain("printed no JSON");
  });
});

describe("isolation", () => {
  test("every role runs with no setting sources and the plugin as its only plugin dir", () => {
    const env = envWith(bin);
    const task = readTask("t1", env);
    for (const role of Object.keys(ROLE_POLICIES)) {
      const { args } = claudeInvocation(task, role, { env });
      expect(valueAfter(args, "--setting-sources")).toBe("");
      expect(valueAfter(args, "--plugin-dir")).toBe(PLUGIN_ROOT);
    }
  });

  test("the plugin dir can be pointed elsewhere", () => {
    const env = envWith(bin);
    const task = readTask("t1", env);
    const { args } = claudeInvocation(task, "reviewer", { env, pluginDir: "/elsewhere" });
    expect(valueAfter(args, "--plugin-dir")).toBe("/elsewhere");
  });

  test("a spawned role receives an empty --setting-sources value and the plugin dir", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    const { argv } = recorded();
    expect(valueAfter(argv, "--setting-sources")).toBe("");
    expect(valueAfter(argv, "--plugin-dir")).toBe(PLUGIN_ROOT);
  });
});

describe("model and resume", () => {
  test("a model passed to the role reaches claude as --model", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "code-writer", { env: envWith(bin), model: "claude-opus-x" });
    expect(valueAfter(recorded().argv, "--model")).toBe("claude-opus-x");
  });

  test("without a model there is no --model, so the agent definition decides", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "code-writer", { env: envWith(bin) });
    expect(recorded().argv).not.toContain("--model");
  });

  test("resuming passes --resume and sends only the new instructions", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "code-writer", {
      env: envWith(bin),
      resumeSessionId: "sess-9",
      instructions: "The PO answered: use a.txt",
    });
    const { argv, stdin } = recorded();
    expect(valueAfter(argv, "--resume")).toBe("sess-9");
    expect(stdin).toBe("The PO answered: use a.txt");
  });

  test("a fresh run has no --resume", () => {
    fakeClaude({ replyFile: SUCCESS });
    runRoleHeadless("t1", "code-writer", { env: envWith(bin) });
    expect(recorded().argv).not.toContain("--resume");
  });
});

describe("structured output", () => {
  const schemaOf = (role: string) => {
    const env = envWith(bin);
    const { args } = claudeInvocation(readTask("t1", env), role, { env });
    return JSON.parse(valueAfter(args, "--json-schema"));
  };

  test("the reviewer must return findings", () => {
    const schema = schemaOf("reviewer");
    expect(schema.required).toEqual(["findings"]);
    expect(schema.properties.findings.items.required).toEqual(["file", "problem", "fix"]);
  });

  test("the tester must return criteria with met and evidence", () => {
    const schema = schemaOf("tester");
    expect(schema.required).toEqual(["criteria"]);
    expect(schema.properties.criteria.items.required).toEqual([
      "criterion",
      "met",
      "evidence",
    ]);
  });

  test("the product owner answers or hands a question to the user", () => {
    const schema = schemaOf("po");
    expect(Object.keys(schema.properties).sort()).toEqual(["answer", "userQuestion"]);
  });

  test("a working role reports done and a summary, with an optional question", () => {
    for (const role of [
      "architect",
      "planner",
      "debugger",
      "test-writer",
      "code-writer",
    ]) {
      const schema = schemaOf(role);
      expect(schema.required).toEqual(["done", "summary"]);
      expect(schema.properties.question.type).toBe("string");
    }
  });

  test("the reply's structured_output reaches the outcome untouched", () => {
    const structured = { findings: [{ file: "a.ts", problem: "p", fix: "f" }] };
    fakeClaude({
      stdout: JSON.stringify({
        type: "result",
        is_error: false,
        result: "",
        structured_output: structured,
      }),
    });
    const outcome = runRoleHeadless("t1", "reviewer", { env: envWith(bin) });
    expect(outcome.structured).toEqual(structured);
    expect(outcome.exitCode).toBe(0);
  });
});

describe("prompt", () => {
  test("every role's prompt tells it to run one command per Bash call", () => {
    const task = readTask("t1", envWith(bin));
    for (const role of Object.keys(ROLE_POLICIES)) {
      expect(roleModule.rolePrompt(task, role)).toContain(ONE_COMMAND_SENTENCE);
    }
  });

  test("a role that can ask is told to set question and stop, one that cannot only not to ask", () => {
    const task = readTask("t1", envWith(bin));
    expect(roleModule.rolePrompt(task, "code-writer")).toContain("set question and stop");
    expect(roleModule.rolePrompt(task, "reviewer")).not.toContain("set question");
    expect(roleModule.rolePrompt(task, "reviewer")).toContain(
      "Never ask the user anything."
    );
  });

  test("the test-writer is told to leave its tests uncommitted", () => {
    const task = readTask("t1", envWith(bin));
    const prompt = roleModule.rolePrompt(task, "test-writer");
    expect(prompt).toContain("uncommitted");
    expect(prompt).not.toContain("and commit them");
  });
});

describe("cli", () => {
  test("parses the model and the session to resume", () => {
    expect(
      parseCliArgs(["t1", "code-writer", "--model", "m-1", "--resume", "sess-3"])
    ).toMatchObject({
      taskId: "t1",
      role: "code-writer",
      model: "m-1",
      resumeSessionId: "sess-3",
    });
    expect(() => parseCliArgs(["t1", "code-writer", "--model"])).toThrow(
      "--model needs a value"
    );
  });

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
      model: undefined,
      resumeSessionId: undefined,
      extraArgs: ["--plugin-dir", "/p"],
    });
    expect(() => parseCliArgs(["t1", "reviewer", "--max-budget-usd", "0"])).toThrow(
      "--max-budget-usd needs a positive number"
    );
    expect(DEFAULT_TIMEOUT_MS).toBe(1800000);
  });
});
