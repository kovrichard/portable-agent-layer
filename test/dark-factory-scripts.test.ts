import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";
import {
  checksFrom,
  classifyChecks,
  waitForCi,
} from "../assets/plugins/dark-factory/scripts/ci-wait.mjs";
import * as gateModule from "../assets/plugins/dark-factory/scripts/gate.mjs";
import { runGate } from "../assets/plugins/dark-factory/scripts/gate.mjs";
import {
  appendEvent,
  readEvents,
  readTask,
  requireTools,
  spawnTool,
  taskDir,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { notify } from "../assets/plugins/dark-factory/scripts/notify.mjs";
import * as rolesModule from "../assets/plugins/dark-factory/scripts/roles.mjs";
import {
  rolesAfterDiff,
  rolesFor,
} from "../assets/plugins/dark-factory/scripts/roles.mjs";
import { summarize } from "../assets/plugins/dark-factory/scripts/stats.mjs";
import * as taskModule from "../assets/plugins/dark-factory/scripts/task.mjs";
import {
  listTasks,
  newTask,
  prepare,
  recordQuestion,
  setStatus,
  slugify,
} from "../assets/plugins/dark-factory/scripts/task.mjs";
import { writeFakeBin } from "./fixtures/fake-bin";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const PLUGIN_ROOT = resolve(import.meta.dir, "../assets/plugins/dark-factory");
const NOW = new Date("2026-10-19T10:00:00Z");
let home: string;
let env: Record<string, string | undefined>;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  env = { ...process.env, DARK_FACTORY_HOME: home };
});

const withoutTools = () => ({
  ...Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "path")
  ),
  PATH: home,
});

const eventsNamed = (name: string) =>
  readEvents(env).filter((event: { event: string }) => event.event === name);

describe("tasks", () => {
  test("a new task gets a dated slug id, a draft status and an empty spec", () => {
    const { id, specPath } = newTask(
      { title: "Add CSV export!", repo: "/repo", category: "feature" },
      env,
      NOW
    );
    expect(id).toBe("2026-10-19-add-csv-export");
    expect(readTask(id, env)).toMatchObject({
      title: "Add CSV export!",
      category: "feature",
      status: "draft",
    });
    expect(readFileSync(specPath, "utf8")).toBe("");
    expect(eventsNamed("task_created")).toEqual([
      expect.objectContaining({ task: id, category: "feature" }),
    ]);
  });

  test("a task's events are also written to its own folder, and a task-less event is not", () => {
    const { id } = newTask(
      { title: "Add CSV export!", repo: "/repo", category: "feature" },
      env,
      NOW
    );
    appendEvent({ event: "gate", task: id }, env);
    appendEvent({ event: "other" }, env);
    const lines = readFileSync(join(taskDir(id, env), "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((line) => line.event)).toContain("gate");
    expect(lines.map((line) => line.event)).not.toContain("other");
  });

  test("an unknown category is refused before anything is written", () => {
    expect(() =>
      newTask({ title: "x", repo: "/repo", category: "epic" }, env, NOW)
    ).toThrow('unknown category "epic"');
    expect(listTasks(env)).toEqual([]);
  });

  test("the same title on the same day is refused instead of overwriting the task", () => {
    newTask({ title: "Fix login", repo: "/repo", category: "bug" }, env, NOW);
    expect(() =>
      newTask({ title: "Fix login", repo: "/repo", category: "bug" }, env, NOW)
    ).toThrow("already exists");
  });

  test("a question to the user parks the task as waiting and is counted", () => {
    const { id } = newTask(
      { title: "Fix login", repo: "/repo", category: "bug" },
      env,
      NOW
    );
    recordQuestion(id, "Should SSO users see it too?", env, NOW);
    expect(readTask(id, env)).toMatchObject({
      status: "waiting",
      note: "Should SSO users see it too?",
    });
    expect(eventsNamed("question_to_user")).toHaveLength(1);
  });

  test("a status change is written to the task and logged", () => {
    const { id } = newTask(
      { title: "Fix login", repo: "/repo", category: "bug" },
      env,
      NOW
    );
    setStatus(id, "stuck", "gate still red", env);
    expect(readTask(id, env)).toMatchObject({ status: "stuck", note: "gate still red" });
    expect(eventsNamed("task_status")).toEqual([
      expect.objectContaining({ status: "stuck" }),
    ]);
  });

  test("slugs keep only lowercase words joined by dashes", () => {
    expect(slugify("  Hello, World -- Again ")).toBe("hello-world-again");
  });
});

describe("roles", () => {
  test("each category maps to a fixed set of roles before and after the code", () => {
    expect(rolesFor("small")).toEqual({ before: [], after: ["reviewer"] });
    expect(rolesFor("bug").before).toEqual(["debugger", "test-writer"]);
    expect(rolesFor("big-feature").before).toEqual([
      "architect",
      "planner",
      "test-writer",
    ]);
  });

  test("a diff touching a UI path adds the tester even when the category left it out", () => {
    expect(
      rolesAfterDiff("small", ["src/app/page.tsx"], { uiPaths: ["src/app/"] })
    ).toEqual(["reviewer", "tester"]);
  });

  test("a diff outside the UI paths adds nothing", () => {
    expect(
      rolesAfterDiff("small", ["src/lib/date.ts"], { uiPaths: ["src/app/"] })
    ).toEqual(["reviewer"]);
  });

  test("the diff check never adds the tester twice", () => {
    expect(
      rolesAfterDiff("feature", ["src/app/page.tsx"], { uiPaths: ["src/app/"] })
    ).toEqual(["reviewer", "tester"]);
  });
});

describe("gate", () => {
  const config = {
    gate: [
      { name: "types", run: "tsc" },
      { name: "tests", run: "test" },
    ],
  };
  const context = { task: "t1", role: "code-writer", attempt: 1, model: "m" };

  test("the gate passes only when every check exits zero", () => {
    const result = runGate("/repo", context, {
      config,
      env,
      run: () => ({ exitCode: 0, output: "" }),
    });
    expect(result).toEqual({ passed: true, failed: [] });
  });

  test("a failing check fails the gate and is reported by name with its output", () => {
    const run = (command: string) =>
      command === "test"
        ? { exitCode: 1, output: "1 failing" }
        : { exitCode: 0, output: "" };
    const result = runGate("/repo", context, { config, env, run });
    expect(result.passed).toBe(false);
    expect(result.failed).toEqual([{ name: "tests", exitCode: 1, output: "1 failing" }]);
    expect(eventsNamed("gate")).toEqual([
      expect.objectContaining({
        result: "fail",
        failed: ["tests"],
        role: "code-writer",
        attempt: 1,
      }),
    ]);
    expect(
      eventsNamed("gate_check").map((event: { result: string }) => event.result)
    ).toEqual(["pass", "fail"]);
  });
});

describe("CI", () => {
  test("any failed or cancelled check fails CI", () => {
    expect(
      classifyChecks([
        { name: "a", bucket: "pass" },
        { name: "b", bucket: "cancel" },
      ])
    ).toEqual({ state: "fail", failed: ["b"] });
  });

  test("CI is pending while a check runs and passes once every check passed or skipped", () => {
    expect(classifyChecks([{ name: "a", bucket: "pending" }]).state).toBe("pending");
    expect(
      classifyChecks([
        { name: "a", bucket: "pass" },
        { name: "b", bucket: "skipping" },
      ]).state
    ).toBe("pass");
    expect(classifyChecks([]).state).toBe("none");
  });

  test("waiting polls until the checks settle and logs the result once", () => {
    writeTask({ id: "t1", pr: "https://pr/1", worktree: "/wt" }, env);
    const answers = [[{ name: "a", bucket: "pending" }], [{ name: "a", bucket: "pass" }]];
    const outcome = waitForCi("t1", {
      env,
      read: () => answers.shift() ?? [],
      pause: () => {},
      pollMs: 1,
      timeoutMs: 10,
    });
    expect(outcome.state).toBe("pass");
    expect(eventsNamed("ci")).toEqual([expect.objectContaining({ result: "pass" })]);
  });

  test("without gh the wait fails loudly instead of reporting a repo with no CI", () => {
    writeTask({ id: "t1", pr: "https://pr/1", worktree: home }, env);
    expect(() =>
      waitForCi("t1", { env: withoutTools(), pause: () => {}, pollMs: 1, timeoutMs: 10 })
    ).toThrow("gh is not installed");
    expect(eventsNamed("ci")).toEqual([]);
  });

  test("a gh error such as a lapsed login is raised, never read as no checks", () => {
    const lapsedLogin = { status: 1, stdout: "", stderr: "HTTP 401: Bad credentials" };
    expect(() => checksFrom(lapsedLogin)).toThrow("Bad credentials");
  });

  test("gh reporting no checks, or pending checks with exit 8, is still read as checks", () => {
    const noChecks = {
      status: 1,
      stdout: "",
      stderr: "no checks reported on the 'x' branch",
    };
    expect(checksFrom(noChecks)).toEqual([]);
    const pending = {
      status: 8,
      stdout: '[{"name":"a","bucket":"pending"}]',
      stderr: "",
    };
    expect(checksFrom(pending)).toEqual([{ name: "a", bucket: "pending" }]);
  });

  test("a wait that runs out of time reports pending so the caller can wait again", () => {
    writeTask({ id: "t1", pr: "https://pr/1", worktree: "/wt" }, env);
    const outcome = waitForCi("t1", {
      env,
      read: () => [{ name: "a", bucket: "pending" }],
      pause: () => {},
      pollMs: 1,
      timeoutMs: 3,
    });
    expect(outcome.state).toBe("pending");
    expect(eventsNamed("ci")).toEqual([]);
  });
});

describe("notify", () => {
  test("the configured command receives the message and the task in its environment", () => {
    const out = join(home, "notified.txt");
    const bashPath = out.replaceAll("\\", "/");
    const result = notify("t1", "ready", "PR is green", {
      ...env,
      DARK_FACTORY_NOTIFY: `{ echo "$DARK_FACTORY_TASK $DARK_FACTORY_KIND"; cat; } > "${bashPath}"`,
    });
    expect(result).toEqual({ delivered: true, configured: true });
    expect(readFileSync(out, "utf8")).toBe("t1 ready\nPR is green");
  });

  test("without a command nothing is delivered, and the attempt is still logged", () => {
    const quiet = { ...env, DARK_FACTORY_NOTIFY: "" };
    expect(notify("t1", "stuck", "help", quiet)).toEqual({
      delivered: false,
      configured: false,
    });
    expect(eventsNamed("notify")).toEqual([
      expect.objectContaining({ delivered: false }),
    ]);
  });
});

describe("stats", () => {
  test("failures and usage are counted from the events alone", () => {
    const stats = summarize([
      { event: "task_created", category: "bug" },
      { event: "gate", role: "code-writer", attempt: 1, result: "fail" },
      { event: "gate", role: "code-writer", attempt: 2, result: "pass" },
      { event: "gate", role: "code-writer", attempt: 1, result: "pass" },
      { event: "gate_check", check: "types", result: "fail" },
      { event: "escalation", from: "code-writer:small", to: "code-writer:medium" },
      { event: "task_status", status: "ready" },
      { event: "task_status", status: "running" },
      { event: "question_to_user" },
    ]);
    expect(stats).toMatchObject({
      tasks: 1,
      byCategory: { bug: 1 },
      outcomes: { ready: 1 },
      gateFailuresByCheck: { types: 1 },
      gateFailuresByRole: { "code-writer": 1 },
      codeWriterFirstTryPassRate: 0.5,
      escalations: { "code-writer:small->code-writer:medium": 1 },
      questionsToUser: 1,
    });
  });

  test("no first tries means no pass rate, not zero", () => {
    expect(summarize([]).codeWriterFirstTryPassRate).toBeNull();
  });
});

describe("tools", () => {
  test("a missing tool is named with how to install it", () => {
    expect(() => spawnTool("gh", ["--version"], { env: withoutTools() })).toThrow(
      "gh is not installed or not on PATH; install it from https://cli.github.com"
    );
  });

  test("the preflight names every missing tool at once", () => {
    expect(() => requireTools(withoutTools())).toThrow("missing tools: git, gh, bash");
  });

  test("a build stops at the preflight before it touches the repo", () => {
    expect(() => prepare("never-created", withoutTools())).toThrow("missing tools");
  });

  test("the preflight passes when the tools are on PATH", () => {
    expect(() => requireTools(env, ["git"])).not.toThrow();
  });
});

test("a malformed event line is skipped instead of breaking every count", () => {
  writeFileSync(join(home, "events.jsonl"), '{"event":"gate"}\nnot json\n');
  expect(readEvents(env)).toEqual([{ event: "gate" }]);
});

type Loose = Record<string, (...args: unknown[]) => unknown>;
const tasks = taskModule as unknown as Loose;
const roleLib = rolesModule as unknown as Loose;
const gateLib = gateModule as unknown as Loose;

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commitFile(cwd: string, name: string, content: string, message = name) {
  mkdirSync(join(cwd, name, ".."), { recursive: true });
  writeFileSync(join(cwd, name), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
}

function remoteWithClone(): { remote: string; clone: string } {
  const remote = join(home, "remote.git");
  const seed = join(home, "seed");
  const clone = join(home, "wt");
  mkdirSync(seed, { recursive: true });
  git(home, "init", "-q", "--bare", "-b", "canary", remote);
  git(seed, "init", "-q", "-b", "canary");
  commitFile(seed, "f.txt", "one\n", "init");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "origin", "canary");
  git(home, "clone", "-q", remote, clone);
  git(clone, "checkout", "-q", "-b", "factory/t1");
  return { remote, clone };
}

function taskAt(worktree: string, extra: object = {}) {
  writeTask(
    {
      id: "t1",
      title: "Fix login",
      repo: home,
      category: "small",
      base: "canary",
      branch: "factory/t1",
      worktree,
      status: "running",
      ...extra,
    },
    env
  );
  writeFileSync(join(home, "tasks", "t1", "spec.md"), "## Goal\n\nx\n");
}

function pathWith(bin: string) {
  return { ...env, ...GIT_ENV, PATH: [bin, process.env.PATH ?? ""].join(delimiter) };
}

function runScript(script: string, args: string[], scriptEnv: object) {
  const run = spawnSync(
    process.execPath,
    [join(PLUGIN_ROOT, "scripts", script), ...args],
    {
      env: scriptEnv as Record<string, string>,
      encoding: "utf8",
    }
  );
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

const lastJson = (stdout: string) => JSON.parse(stdout.trim().split("\n").at(-1) ?? "");

describe("decisions", () => {
  const entry = {
    role: "code-writer",
    question: "which\nfile?",
    answer: "use a.txt\nplease",
  };

  test("a decision is one line naming the role, the question and the answer", () => {
    expect(tasks.decisionLine?.(entry, NOW)).toBe(
      '- 2026-10-19: the code-writer asked "which file?"; the PO answered: use a.txt please'
    );
  });

  test("a decision lands at the end of the Decisions section, before the next heading", () => {
    const spec = "## Goal\n\ng\n\n## Decisions\n\n- earlier\n\n## Notes\n\nn\n";
    expect(tasks.withDecision?.(spec, "- new")).toBe(
      "## Goal\n\ng\n\n## Decisions\n\n- earlier\n- new\n\n## Notes\n\nn\n"
    );
  });

  test("a spec without a Decisions section gets one", () => {
    expect(tasks.withDecision?.("## Goal\n\ng\n", "- new")).toBe(
      "## Goal\n\ng\n\n## Decisions\n\n- new\n"
    );
  });

  test("an empty Decisions section takes the line under its heading", () => {
    expect(tasks.withDecision?.("## Decisions\n", "- new")).toBe(
      "## Decisions\n\n- new\n"
    );
  });

  test("appending writes the spec and logs a decision event for the role", () => {
    const { id, specPath } = newTask(
      { title: "Fix login", repo: "/repo", category: "small" },
      env,
      NOW
    );
    writeFileSync(specPath, "## Goal\n\ng\n\n## Decisions\n\n- earlier\n");
    tasks.appendDecision?.(id, entry, env, NOW);
    const spec = readFileSync(specPath, "utf8");
    expect(spec).toContain("- earlier\n- 2026-10-19: the code-writer asked");
    expect(spec).toContain("use a.txt please");
    expect(eventsNamed("decision")).toEqual([
      expect.objectContaining({ task: id, role: "code-writer" }),
    ]);
  });
});

describe("where a task is", () => {
  test("show prints the task with the latest step from the event log", () => {
    const { id } = newTask(
      { title: "Fix login", repo: "/repo", category: "small" },
      env,
      NOW
    );
    writeFileSync(
      join(home, "events.jsonl"),
      [
        { ts: "2026-10-19T10:00:00Z", event: "task_started", task: id },
        { ts: "2026-10-19T10:01:00Z", event: "gate", task: "other", result: "pass" },
        { ts: "2026-10-19T10:02:00Z", event: "gate", task: id, result: "fail" },
        { ts: "2026-10-19T10:03:00Z", event: "gate", task: "other", result: "fail" },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")
    );
    const shown = runScript("task.mjs", ["show", id], pathWith(home));
    expect(lastJson(shown.stdout)).toMatchObject({
      id,
      latestStep: { event: "gate", task: id, result: "fail" },
    });
  });

  test("a just-created task's latest step is its task_created event", () => {
    const { id } = newTask(
      { title: "Fix login", repo: "/repo", category: "small" },
      env,
      NOW
    );
    const shown = runScript("task.mjs", ["show", id], pathWith(home));
    expect(lastJson(shown.stdout).latestStep).toMatchObject({
      event: "task_created",
      task: id,
    });
  });
});

describe("result schemas", () => {
  test("each role maps to its result shape, with the working roles as the default", () => {
    const shapeOf = (role: string) => Object.keys(roleLib.schemaFor?.(role) as object);
    const schema = (role: string) => roleLib.schemaFor?.(role) as { required?: string[] };
    expect(shapeOf("reviewer")).toContain("properties");
    expect(schema("reviewer").required).toEqual(["findings"]);
    expect(schema("tester").required).toEqual(["criteria"]);
    expect(schema("po").required).toBeUndefined();
    expect(schema("code-writer").required).toEqual(["done", "summary"]);
    expect(schema("planner").required).toEqual(["done", "summary"]);
  });
});

describe("roles after the diff", () => {
  test("a changed UI path adds the tester and reports it as added", () => {
    const { clone } = remoteWithClone();
    writeFileSync(
      join(clone, ".dark-factory.json"),
      JSON.stringify({ gate: [], uiPaths: ["src/app/"] })
    );
    commitFile(clone, "src/app/page.tsx", "x");
    expect(roleLib.rolesAfter?.("small", clone, "origin/canary", env)).toEqual({
      roles: ["reviewer", "tester"],
      added: ["tester"],
    });
  });

  test("a diff outside the UI paths adds nothing", () => {
    const { clone } = remoteWithClone();
    writeFileSync(
      join(clone, ".dark-factory.json"),
      JSON.stringify({ gate: [], uiPaths: ["src/app/"] })
    );
    commitFile(clone, "src/lib/date.ts", "x");
    expect(roleLib.rolesAfter?.("small", clone, "origin/canary", env)).toEqual({
      roles: ["reviewer"],
      added: [],
    });
  });
});

describe("a gate check on its own", () => {
  test("runCheck returns the exit code and the combined output of one command", () => {
    expect(gateLib.runCheck?.("echo out; echo err >&2; exit 3", home, env)).toEqual({
      exitCode: 3,
      output: expect.stringContaining("out"),
    });
    const passing = gateLib.runCheck?.("echo fine", home, env) as { exitCode: number };
    expect(passing.exitCode).toBe(0);
  });

  test("runCheck runs in the folder it is given", () => {
    const output = (gateLib.runCheck?.("pwd", home, env) as { output: string }).output;
    expect(output.trim().length).toBeGreaterThan(0);
    expect(output).toContain(home.split(/[\\/]/).at(-1) as string);
  });
});

function fakeGh(bin: string, prList: string) {
  mkdirSync(bin, { recursive: true });
  const log = join(bin, "gh.log");
  writeFakeBin(
    bin,
    "gh",
    [
      `const fs = require("node:fs");`,
      `const args = process.argv.slice(2);`,
      `fs.appendFileSync(${JSON.stringify(log)}, args.join(" ") + "\\n");`,
      `if (args[0] === "pr" && args[1] === "list") process.stdout.write(${JSON.stringify(prList)});`,
      `else if (args[0] === "pr" && args[1] === "create") process.stdout.write("https://github.com/o/r/pull/7\\n");`,
      "",
    ].join("\n")
  );
  return log;
}

describe("opening the pull request", () => {
  test("an open pull request for the branch is adopted, not duplicated", () => {
    const bin = join(home, "bin");
    const log = fakeGh(bin, '[{"url":"https://github.com/o/r/pull/9"}]');
    taskAt(home);
    const run = runScript("ship.mjs", ["pr", "t1"], pathWith(bin));
    expect(lastJson(run.stdout).pr).toBe("https://github.com/o/r/pull/9");
    expect(readTask("t1", env).pr).toBe("https://github.com/o/r/pull/9");
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("pr list --head factory/t1");
    expect(calls).not.toContain("pr create");
  });

  test("with no open pull request one is created and recorded", () => {
    const bin = join(home, "bin");
    const log = fakeGh(bin, "[]");
    taskAt(home);
    const run = runScript("ship.mjs", ["pr", "t1"], pathWith(bin));
    expect(lastJson(run.stdout).pr).toBe("https://github.com/o/r/pull/7");
    expect(readTask("t1", env).pr).toBe("https://github.com/o/r/pull/7");
    expect(readFileSync(log, "utf8")).toContain("pr create");
  });

  test("a task that already has a pull request asks gh nothing", () => {
    const bin = join(home, "bin");
    const log = fakeGh(bin, "[]");
    taskAt(home, { pr: "https://github.com/o/r/pull/3" });
    const run = runScript("ship.mjs", ["pr", "t1"], pathWith(bin));
    expect(lastJson(run.stdout).pr).toBe("https://github.com/o/r/pull/3");
    expect(existsSync(log)).toBe(false);
  });
});

describe("syncing with the base", () => {
  test("a rebase that cannot start is a failure, not a conflict with the base", () => {
    const { clone } = remoteWithClone();
    commitFile(clone, "g.txt", "mine\n");
    writeFileSync(join(clone, "f.txt"), "dirty\n");
    taskAt(clone);
    const run = runScript("ship.mjs", ["sync", "t1"], pathWith(join(home, "nobin")));
    const result = lastJson(run.stdout);
    expect(result.conflict).not.toBe(true);
    expect(result.error).toContain("rebase");
  });

  test("a real conflict is reported as one and the rebase is left aborted", () => {
    const { clone } = remoteWithClone();
    commitFile(clone, "f.txt", "mine\n");
    const other = join(home, "other");
    git(home, "clone", "-q", join(home, "remote.git"), other);
    commitFile(other, "f.txt", "theirs\n");
    git(other, "push", "-q", "origin", "canary");
    taskAt(clone);
    const run = runScript("ship.mjs", ["sync", "t1"], pathWith(join(home, "nobin")));
    expect(lastJson(run.stdout).conflict).toBe(true);
    expect(run.status).toBe(1);
    expect(existsSync(join(clone, ".git", "rebase-merge"))).toBe(false);
    expect(readFileSync(join(clone, "f.txt"), "utf8")).toBe("mine\n");
  });

  test("a clean rebase moves the branch onto the base", () => {
    const { clone } = remoteWithClone();
    commitFile(clone, "g.txt", "mine\n");
    const other = join(home, "other");
    git(home, "clone", "-q", join(home, "remote.git"), other);
    commitFile(other, "h.txt", "theirs\n");
    git(other, "push", "-q", "origin", "canary");
    taskAt(clone);
    const run = runScript("ship.mjs", ["sync", "t1"], pathWith(join(home, "nobin")));
    expect(lastJson(run.stdout)).toMatchObject({ rebased: true, conflict: false });
    expect(existsSync(join(clone, "h.txt"))).toBe(true);
  });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("the plugin's own files", () => {
  test("nothing in the plugin skips commit hooks", () => {
    for (const file of filesUnder(PLUGIN_ROOT)) {
      const text = readFileSync(file, "utf8");
      expect({ file, skipsHooks: text.includes("--no-verify") }).toEqual({
        file,
        skipsHooks: false,
      });
      expect({ file, skipsHooks: text.includes("HUSKY=0") }).toEqual({
        file,
        skipsHooks: false,
      });
    }
  });

  test("the test-writer agent leaves tests for the code writer to commit", () => {
    const agent = readFileSync(join(PLUGIN_ROOT, "agents/test-writer.md"), "utf8");
    expect(agent).toContain("uncommitted");
    expect(agent).not.toContain("Commit the tests");
  });

  test("the code-writer and the debugger commit the waiting tests through the hooks", () => {
    for (const role of ["code-writer", "debugger"]) {
      const agent = readFileSync(join(PLUGIN_ROOT, `agents/${role}.md`), "utf8");
      expect(agent).toContain("uncommitted tests");
    }
  });

  test("the workflow file is gone", () => {
    expect(existsSync(join(PLUGIN_ROOT, "workflows/build.js"))).toBe(false);
  });

  test("the po skill starts the headless build in the background and no workflow", () => {
    const skill = readFileSync(join(PLUGIN_ROOT, "skills/po/SKILL.md"), "utf8");
    expect(skill).toContain("scripts/build.mjs");
    expect(skill).toContain("run_in_background");
    expect(skill).not.toContain("dark-factory:build");
    expect(skill.toLowerCase()).not.toContain("workflow");
    expect(skill).toContain("task.mjs show");
  });

  test("the readme's Use, Measuring and Permissions sections describe the headless build", () => {
    const readme = readFileSync(join(PLUGIN_ROOT, "README.md"), "utf8");
    const section = (name: string) =>
      readme.split(/^## /m).find((part) => part.startsWith(`${name}\n`)) ?? "";
    expect(section("Use")).toContain("build.mjs");
    expect(section("Use")).toContain("terminal");
    expect(section("Measuring")).toContain("run_finished");
    expect(section("Permissions")).toContain("--setting-sources");
    expect(readme.toLowerCase()).not.toContain("workflow");
  });
});
