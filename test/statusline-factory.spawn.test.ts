import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const repo = resolve(import.meta.dir, "..");
const SESSION_JSON = JSON.stringify({
  model: { display_name: "Opus" },
  workspace: { current_dir: "/tmp" },
});
const isWindows = process.platform === "win32";

let HOME: string;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function task(
  id: string,
  status: string,
  events: Record<string, unknown>[],
  pr?: string
): void {
  const dir = resolve(HOME, ".dark-factory", "tasks", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "task.json"),
    JSON.stringify({ id, status, ...(pr ? { pr } : {}) })
  );
  writeFileSync(
    resolve(dir, "events.jsonl"),
    events.map((event) => `${JSON.stringify({ task: id, ...event })}\n`).join("")
  );
}

function render(): string {
  const env = { ...process.env, HOME, USERPROFILE: HOME, DARK_FACTORY_HOME: "" };
  const run = isWindows
    ? spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve(repo, "assets", "statusline.ps1"),
        ],
        { input: SESSION_JSON, encoding: "utf-8", env }
      )
    : spawnSync("bash", [resolve(repo, "assets", "statusline.sh")], {
        input: SESSION_JSON,
        encoding: "utf-8",
        env,
      });
  return run.stdout ?? "";
}

function factoryLines(): string[] {
  return render()
    .split("\n")
    .filter((line) => line.includes("🏭") || line.includes("[factory]"));
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
});

describe("the dark-factory line", () => {
  test("shows a building task's role, minutes in it, last gate and PR", () => {
    task(
      "2026-11-05-planner-plans-catch-spec-drift",
      "running",
      [
        { ts: minutesAgo(20), event: "role_run", role: "planner" },
        { ts: minutesAgo(15), event: "gate", result: "pass" },
        { ts: minutesAgo(12), event: "role_run", role: "code-writer" },
      ],
      "https://github.com/owner/repo/pull/195"
    );
    const [line] = factoryLines();
    expect(line).toContain("planner-plans-catch-spec-dri");
    expect(line).not.toContain("2026-11-05");
    expect(line).toContain("code-writer 12m");
    expect(line).toMatch(/gate (✓|ok)/);
    expect(line).toContain("PR #195");
    expect(line).not.toContain("no activity");
  });

  test("marks a failed gate", () => {
    task("2026-11-05-failing", "running", [
      { ts: minutesAgo(3), event: "role_run", role: "code-writer" },
      { ts: minutesAgo(1), event: "gate", result: "fail" },
    ]);
    expect(factoryLines()[0]).toMatch(/gate (✗|FAIL)/);
  });

  test("says when a running task has been silent past a role's timeout", () => {
    task("2026-11-05-crashed", "running", [
      { ts: minutesAgo(50), event: "role_run", role: "debugger" },
    ]);
    expect(factoryLines()[0]).toContain("no activity 50m");
  });

  test("says when a task waits on the user", () => {
    task("2026-11-05-asks", "waiting", [
      { ts: minutesAgo(5), event: "question_to_user" },
    ]);
    expect(factoryLines()[0]).toContain("waiting on you");
  });

  test("shows a running task that has no events yet as starting", () => {
    task("2026-11-05-fresh", "running", []);
    expect(factoryLines()[0]).toContain("starting");
  });

  test("leaves out finished tasks and draws nothing without a factory", () => {
    expect(factoryLines()).toEqual([]);
    task("2026-11-04-done", "merged", [
      { ts: minutesAgo(90), event: "role_run", role: "reviewer" },
    ]);
    task("2026-11-04-ready", "ready", []);
    expect(factoryLines()).toEqual([]);
  });

  test("gives each active task its own line", () => {
    task("2026-11-05-one", "running", [
      { ts: minutesAgo(2), event: "role_run", role: "planner" },
    ]);
    task("2026-11-05-two", "waiting", []);
    expect(factoryLines()).toHaveLength(2);
  });
});
