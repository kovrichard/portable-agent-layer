import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { timeboxCommand, unattendedCommand } from "../src/cli/run-mode";
import { scopeOf } from "../src/hooks/lib/progress-tree";
import {
  DEFAULT_UNATTENDED_RULES,
  describeRun,
  GIT_RULE,
  type Run,
  readRun,
  untilLabel,
} from "../src/hooks/lib/run-mode";
import { type Command, runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

let printed: string[];
let errors: string[];

beforeEach(() => {
  mock.restore();
  process.env.PAL_HOME = freshTestDir(import.meta.file);
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
    expect(await unattended("start", "--for", "8h")).toBe(1);
    expect(errors.join("\n")).toContain("give each approved task with --task");
    expect(stored()).toBeNull();
  });

  test("start stores tasks, fallbacks and the default rules plus extras, and prints them", async () => {
    const code = await unattended(
      "start",
      "--for",
      "8h",
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
    await unattended("start", "--for", "8h", "--task", "t");
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
    await unattended("start", "--for", "8h", "--task", "t");
    printed = [];
    expect(await unattended("done")).toBe(0);
    expect(stored()?.done).toBe(true);
    expect(printed).toEqual([
      "Marked done: the agent may stop. The run ends when the user is back.",
    ]);
  });

  test("end clears the run", async () => {
    await unattended("start", "--for", "8h", "--task", "t");
    expect(await unattended("end")).toBe(0);
    expect(stored()).toBeNull();
  });
});
