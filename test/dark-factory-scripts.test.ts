import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checksFrom,
  classifyChecks,
  waitForCi,
} from "../assets/plugins/dark-factory/scripts/ci-wait.mjs";
import { runGate } from "../assets/plugins/dark-factory/scripts/gate.mjs";
import {
  appendEvent,
  readEvents,
  readTask,
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
  recordQuestion,
  setStatus,
  slugify,
} from "../assets/plugins/dark-factory/scripts/task.mjs";
import {
  eventsNamedIn,
  type FactoryEnv,
  freshFactoryHome,
  NOW,
  PLUGIN_ROOT,
} from "./lib/dark-factory-scripts-fixture";

let home: string;
let env: FactoryEnv;

beforeEach(() => {
  ({ home, env } = freshFactoryHome(import.meta.file));
});

const eventsNamed = (name: string) => eventsNamedIn(env, name);

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

test("a malformed event line is skipped instead of breaking every count", () => {
  writeFileSync(join(home, "events.jsonl"), '{"event":"gate"}\nnot json\n');
  expect(readEvents(env)).toEqual([{ event: "gate" }]);
});

type Loose = Record<string, (...args: unknown[]) => unknown>;
const tasks = taskModule as unknown as Loose;
const roleLib = rolesModule as unknown as Loose;

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

describe("coach support in the shared scripts", () => {
  test("the coach result requires findings, updates and reviewed", () => {
    const schema = roleLib.schemaFor?.("coach") as { required?: string[] };
    expect(schema.required).toEqual(["findings", "updates", "reviewed"]);
  });

  test("each reviewed item needs a source, a verdict and a reason", () => {
    const schema = roleLib.schemaFor?.("coach") as {
      properties: {
        reviewed: {
          items: {
            required: string[];
            properties: {
              verdict: { enum: string[] };
              class: { type: string };
            };
          };
        };
      };
    };
    const item = schema.properties.reviewed.items;
    expect(item.required).toEqual(["source", "verdict", "reason"]);
    expect(item.properties.verdict.enum).toEqual(["finding", "clean"]);
    expect(item.properties.class.type).toBe("string");
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

  test("the debugger ends repro.md with a Fix section that picks one fix and names the helpers", () => {
    const agent = readFileSync(join(PLUGIN_ROOT, "agents/debugger.md"), "utf8");
    expect(agent).toContain("End `repro.md` with a **Fix** section");
    expect(agent).toContain("picks exactly one fix, with no alternatives left open");
    expect(agent).toContain("lists each file to change, with the path and the functions");
    expect(agent).toContain("names the existing helpers to reuse, by path and name");
    expect(agent).toContain(
      "says not to write new code where a helper already does the job"
    );
  });

  test("the reviewer reports duplicated helpers and unrequested complexity", () => {
    const agent = readFileSync(join(PLUGIN_ROOT, "agents/reviewer.md"), "utf8");
    expect(agent).toContain(
      "new code that duplicates an existing helper in the repo, naming the helper by path and name"
    );
    expect(agent).toContain("complexity the spec does not ask for");
  });

  test("the code-writer follows the Fix section of repro.md when there is no plan", () => {
    const agent = readFileSync(join(PLUGIN_ROOT, "agents/code-writer.md"), "utf8");
    expect(agent).toContain(
      "When there is no `plan.md`, follow the **Fix** section of `repro.md` the same way"
    );
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
