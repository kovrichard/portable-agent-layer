import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { waitForCi } from "../assets/plugins/dark-factory/scripts/ci-wait.mjs";
import * as gateModule from "../assets/plugins/dark-factory/scripts/gate.mjs";
import {
  readTask,
  requireTools,
  spawnTool,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { notify } from "../assets/plugins/dark-factory/scripts/notify.mjs";
import * as rolesModule from "../assets/plugins/dark-factory/scripts/roles.mjs";
import { newTask, prepare } from "../assets/plugins/dark-factory/scripts/task.mjs";
import { writeFakeBin } from "./fixtures/fake-bin";
import {
  eventsNamedIn,
  type FactoryEnv,
  freshFactoryHome,
  NOW,
  PLUGIN_ROOT,
} from "./lib/dark-factory-scripts-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

let home: string;
let env: FactoryEnv;

beforeEach(() => {
  ({ home, env } = freshFactoryHome(import.meta.file));
});

const withoutTools = () => ({
  ...Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "path")
  ),
  PATH: home,
});

const eventsNamed = (name: string) => eventsNamedIn(env, name);

describe("CI", () => {
  test("without gh the wait fails loudly instead of reporting a repo with no CI", () => {
    writeTask({ id: "t1", pr: "https://pr/1", worktree: home }, env);
    expect(() =>
      waitForCi("t1", { env: withoutTools(), pause: () => {}, pollMs: 1, timeoutMs: 10 })
    ).toThrow("gh is not installed");
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

  test("the preflight finds the tools without running them", () => {
    const bin = join(home, "bin");
    const ran = join(bin, "ran.log");
    mkdirSync(bin, { recursive: true });
    for (const tool of ["git", "gh", "bash"])
      writeFakeBin(
        bin,
        tool,
        `require("node:fs").appendFileSync(${JSON.stringify(ran)}, "${tool}\\n");\n`
      );

    const path = [bin, dirname(process.execPath)].join(delimiter);
    expect(() => requireTools({ ...withoutTools(), PATH: path })).not.toThrow();
    expect(existsSync(ran)).toBe(false);
  });
});

type Loose = Record<string, (...args: unknown[]) => unknown>;
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

describe("coach support in the shared scripts", () => {
  test("pushed records the head commit that was pushed", () => {
    const { clone } = remoteWithClone();
    commitFile(clone, "g.txt", "mine\n");
    taskAt(clone);
    const run = runScript("ship.mjs", ["push", "t1"], pathWith(join(home, "nobin")));
    expect(run.status).toBe(0);
    const [pushed] = eventsNamed("pushed") as { head?: string }[];
    expect(pushed?.head).toBe(git(clone, "rev-parse", "HEAD"));
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
