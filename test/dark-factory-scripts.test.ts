import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checksFrom,
  classifyChecks,
  waitForCi,
} from "../assets/plugins/dark-factory/scripts/ci-wait.mjs";
import { runGate } from "../assets/plugins/dark-factory/scripts/gate.mjs";
import {
  readEvents,
  readTask,
  requireTools,
  spawnTool,
  writeTask,
} from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { notify } from "../assets/plugins/dark-factory/scripts/notify.mjs";
import {
  rolesAfterDiff,
  rolesFor,
} from "../assets/plugins/dark-factory/scripts/roles.mjs";
import { summarize } from "../assets/plugins/dark-factory/scripts/stats.mjs";
import {
  listTasks,
  newTask,
  prepare,
  recordQuestion,
  recordTrace,
  setStatus,
  slugify,
} from "../assets/plugins/dark-factory/scripts/task.mjs";
import { freshTestDir } from "./lib/test-home";

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

  test("a workflow trace arrives as one event per entry, tagged with the task", () => {
    const trace = JSON.stringify([
      { event: "role_run", role: "planner" },
      { event: "review", round: 1 },
    ]);
    expect(recordTrace("t1", trace, env)).toEqual({ recorded: 2 });
    expect(eventsNamed("role_run")).toEqual([
      expect.objectContaining({ task: "t1", role: "planner" }),
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
