import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { timeboxCommand, unattendedCommand } from "../src/cli/run-mode";
import { appendEvent } from "../src/hooks/lib/events";
import { scopeOf } from "../src/hooks/lib/progress-tree";
import {
  type RunEstimateRecord,
  runEstimateRecord,
  runEstimatesFile,
} from "../src/hooks/lib/run-estimates";
import {
  DEFAULT_UNATTENDED_RULES,
  describeRun,
  GIT_RULE,
  newRun,
  type Run,
  readRun,
  untilLabel,
} from "../src/hooks/lib/run-mode";
import { type Command, runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

const RUN_SESSION = "night-session";
let printed: string[];
let errors: string[];

beforeEach(() => {
  mock.restore();
  process.env.PAL_HOME = freshTestDir(import.meta.file);
  process.env.PAL_AGENT = "claude";
  process.env.CLAUDE_CODE_SESSION_ID = RUN_SESSION;
  printed = [];
  errors = [];
  spyOn(console, "log").mockImplementation((...args) => printed.push(args.join(" ")));
  spyOn(console, "error").mockImplementation((...args) => errors.push(args.join(" ")));
});

function timebox(...args: string[]): Promise<number> {
  return runCommand(timeboxCommand, args, ["pal", "cli", "timebox"]);
}

function unattended(...args: string[]): Promise<number> {
  return runCommand(unattendedCommand as Command, args, ["pal", "cli", "unattended"]);
}

function stored(): Run | null {
  return readRun(scopeOf(process.cwd()));
}

function startNight(): Promise<number> {
  return unattended("start", "--for", "8h", "--estimate", "45m", "--task", "t");
}

function estimateRecords(): RunEstimateRecord[] {
  const file = runEstimatesFile();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RunEstimateRecord);
}

describe("pal cli timebox", () => {
  test("start stores the box with its task and report, and says when it ends", async () => {
    expect(
      await timebox("start", "--for", "15m", "--task", "research", "--report", "r.md")
    ).toBe(0);
    const run = stored();
    expect(run).toMatchObject({ kind: "timebox", task: "research", report: "r.md" });
    expect(printed).toEqual([
      `Time box set: ends at ${untilLabel(run as Run)}. After that only \`pal cli\` and report edits run.`,
    ]);
  });

  test("start refuses a second box and keeps the first", async () => {
    await timebox("start", "--for", "15m", "--task", "first");
    expect(await timebox("start", "--for", "5m")).toBe(1);
    expect(errors.join("\n")).toContain("A timebox run until");
    expect(errors.join("\n")).toContain("is already on here; end it first");
    expect(stored()?.task).toBe("first");
  });

  test("start refuses a duration it cannot read", async () => {
    expect(await timebox("start", "--for", "7x")).toBe(1);
    expect(errors.join("\n")).toContain('Not a duration: "7x"');
    expect(stored()).toBeNull();
  });

  test("status prints the box", async () => {
    await timebox("start", "--for", "15m");
    printed = [];
    expect(await timebox("status")).toBe(0);
    expect(printed).toEqual([describeRun(stored() as Run)]);
  });

  test("status and end report a missing box", async () => {
    expect(await timebox("status")).toBe(1);
    expect(await timebox("end")).toBe(1);
    expect(errors).toEqual([
      `No timebox run in ${scopeOf(process.cwd())}.`,
      `No timebox run in ${scopeOf(process.cwd())}.`,
    ]);
  });

  test("end clears the box and names when it was due", async () => {
    await timebox("start", "--for", "15m");
    const label = untilLabel(stored() as Run);
    printed = [];
    expect(await timebox("end")).toBe(0);
    expect(printed).toEqual([`Ended the timebox run that was due at ${label}.`]);
    expect(stored()).toBeNull();
  });
});

describe("pal cli unattended", () => {
  test("start needs at least one approved task", async () => {
    expect(await unattended("start", "--for", "8h", "--estimate", "1h")).toBe(1);
    expect(errors.join("\n")).toContain("give each approved task with --task");
    expect(stored()).toBeNull();
  });

  test("start needs an estimate it can read", async () => {
    expect(await unattended("start", "--for", "8h", "--task", "t")).toBe(1);
    expect(errors.join("\n")).toContain(
      "give how long the tasks and fallbacks will take with --estimate"
    );
    expect(
      await unattended("start", "--for", "8h", "--task", "t", "--estimate", "x")
    ).toBe(1);
    expect(errors.join("\n")).toContain('Not a duration: "x"');
    expect(stored()).toBeNull();
  });

  test("start stores tasks, fallbacks and the default rules plus extras, and prints them", async () => {
    const code = await unattended(
      "start",
      "--for",
      "8h",
      "--estimate",
      "1h30m",
      "--task",
      "fix parser",
      "--task",
      "add tests",
      "--fallback",
      "lint",
      "--rule",
      "no downloads",
      "--report",
      "report.md"
    );
    expect(code).toBe(0);
    const run = stored() as Run;
    expect(run).toMatchObject({
      kind: "unattended",
      tasks: ["fix parser", "add tests"],
      fallbacks: ["lint"],
      rules: [...DEFAULT_UNATTENDED_RULES, GIT_RULE, "no downloads"],
      report: "report.md",
      estimateMinutes: 90,
    });
    expect(printed).toEqual([describeRun(run)]);
  });

  test("a time box is not an unattended run", async () => {
    await timebox("start", "--for", "15m");
    expect(await unattended("status")).toBe(1);
    expect(await unattended("done")).toBe(1);
    expect(await unattended("log", "x")).toBe(1);
    expect(stored()?.kind).toBe("timebox");
  });

  test("log appends timestamped entries", async () => {
    await startNight();
    printed = [];
    const before = Date.now();
    await unattended("log", "parser", "fixed");
    await unattended("log", "tests added");
    const after = Date.now();
    expect(printed).toEqual(["Logged (1 entries).", "Logged (2 entries)."]);
    const log = stored()?.log ?? [];
    expect(log.map((l) => l.entry)).toEqual(["parser fixed", "tests added"]);
    for (const { at } of log) {
      expect(Date.parse(at)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(at)).toBeLessThanOrEqual(after);
    }
  });

  test("done marks the run done and keeps it until the user is back", async () => {
    await startNight();
    printed = [];
    expect(await unattended("done")).toBe(0);
    expect(stored()?.done).toBe(true);
    expect(printed).toEqual([
      "Marked done: the agent may stop. The run ends when the user is back.",
    ]);
  });

  test("end clears the run", async () => {
    await startNight();
    expect(await unattended("end")).toBe(0);
    expect(stored()).toBeNull();
  });
});

describe("estimated against actual time", () => {
  test("done records the estimate next to the minutes it took, once", async () => {
    await startNight();
    const run = stored() as Run;
    await unattended("log", "parser fixed");
    const before = Date.now();
    await unattended("done");
    await unattended("done");
    await unattended("end");
    const records = estimateRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "unattended",
      scope: run.scope,
      startedAt: run.startedAt,
      until: run.until,
      estimateMinutes: 45,
      finished: true,
      actualMinutes: 0,
      tasks: ["t"],
      fallbacks: [],
      logEntries: 1,
    });
    expect(Date.parse(records[0].finishedAt as string)).toBeGreaterThanOrEqual(before);
  });

  test("done stores what the run did, read off the event log", async () => {
    await startNight();
    const here = process.cwd();
    const call = (tool: string, outcome: string, session: string | null, cwd: string) =>
      appendEvent("tool_call", { tool, outcome }, { session, cwd });
    call("Bash", "ok", RUN_SESSION, here);
    call("Edit", "failed", RUN_SESSION, "/elsewhere");
    call("Read", "ok", "someone-else", here);
    call("Write", "ok", null, here);
    call("Grep", "ok", null, "/elsewhere");
    await unattended("done");
    expect(estimateRecords()[0]).toMatchObject({
      stopBlocks: 0,
      stats: {
        complete: true,
        sessions: 1,
        toolCalls: 3,
        toolCallsFailed: 1,
        byTool: { Bash: 1, Edit: 1, Write: 1 },
      },
    });
  });

  test("the run keeps every session that worked on it", async () => {
    await startNight();
    process.env.CLAUDE_CODE_SESSION_ID = "after-a-restart";
    await unattended("log", "resumed");
    await unattended("log", "again");
    expect(stored()?.sessions).toEqual([RUN_SESSION, "after-a-restart"]);
  });

  test("a run ended before it was done is recorded as unfinished", async () => {
    await startNight();
    await unattended("end");
    expect(estimateRecords()).toEqual([
      expect.objectContaining({
        estimateMinutes: 45,
        finished: false,
        finishedAt: null,
        actualMinutes: null,
      }),
    ]);
  });

  test("a time box records nothing", async () => {
    await timebox("start", "--for", "15m");
    await timebox("end");
    expect(estimateRecords()).toEqual([]);
  });

  test("the minutes taken run from the start to done", () => {
    const run = newRun({
      kind: "unattended",
      scope: "s",
      now: new Date("2026-10-31T16:00:00Z"),
      until: new Date("2026-10-31T20:00:00Z"),
    });
    expect(runEstimateRecord(run, new Date("2026-10-31T17:14:40Z")).actualMinutes).toBe(
      75
    );
  });
});
