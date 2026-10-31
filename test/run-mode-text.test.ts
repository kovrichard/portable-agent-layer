import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scopeOf } from "../src/hooks/lib/progress-tree";
import {
  clearRun,
  DEFAULT_UNATTENDED_RULES,
  deadlineFrom,
  describeRun,
  GIT_RULE,
  isOver,
  minutesLeft,
  newRun,
  type Run,
  readRun,
  unattendedRules,
  writeRun,
} from "../src/hooks/lib/run-mode";
import {
  runModePromptLine,
  runModeRecall,
  runModeRefusal,
  unattendedStopReason,
} from "../src/hooks/lib/run-mode-gate";
import { freshTestDir } from "./lib/test-home";

const CWD = "/work/run-text";
const NOW = new Date("2026-10-31T16:00:00Z");
const BEFORE = new Date("2026-10-31T16:10:00Z");
const AFTER = new Date("2026-10-31T16:40:00Z");
const UNTIL = new Date("2026-10-31T16:30:00Z");
const HOUR = 3_600_000;

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
});

function run(kind: Run["kind"], extra: Partial<Run> = {}): Run {
  return { ...newRun({ kind, scope: scopeOf(CWD), until: UNTIL, now: NOW }), ...extra };
}

function start(kind: Run["kind"], extra: Partial<Run> = {}): Run {
  const stored = run(kind, extra);
  writeRun(stored);
  return stored;
}

function at(iso: string): string {
  return new Date(iso).toISOString();
}

describe("durations", () => {
  test.each([
    ["2h", 2 * HOUR],
    ["90s", 90_000],
    ["1h30m15s", HOUR + 30 * 60_000 + 15_000],
    [" 15m ", 15 * 60_000],
  ])("%p is added to now", (spec, ms) => {
    expect(deadlineFrom({ for: spec }, NOW).getTime()).toBe(NOW.getTime() + ms);
  });

  test.each(["", "15", "m", "1d"])("%p is refused", (spec) => {
    expect(() => deadlineFrom({ for: spec }, NOW)).toThrow(
      `Not a duration: "${spec}". Use 15m, 2h or 1h30m.`
    );
  });
});

describe("clock times", () => {
  test("23:59 is the last minute of the day", () => {
    expect(deadlineFrom({ until: "23:59" }, NOW).toISOString()).toBe(
      at("2026-10-31T23:59:00Z")
    );
  });

  test("the current minute means the same minute tomorrow", () => {
    expect(deadlineFrom({ until: "16:00" }, NOW).toISOString()).toBe(
      at("2026-11-01T16:00:00Z")
    );
  });

  test("seconds past the minute do not shift the deadline", () => {
    const now = new Date("2026-10-31T16:00:45Z");
    expect(deadlineFrom({ until: "18:00" }, now).toISOString()).toBe(
      at("2026-10-31T18:00:00Z")
    );
  });

  test.each(["24:00", "18:60", "noon"])("%p is refused", (spec) => {
    expect(() => deadlineFrom({ until: spec }, NOW)).toThrow(
      `Not a future time: "${spec}". Use HH:MM or an ISO time.`
    );
  });

  test("an ISO time is taken when it is in the future", () => {
    expect(deadlineFrom({ until: "2026-11-02T05:30:00Z" }, NOW).toISOString()).toBe(
      at("2026-11-02T05:30:00Z")
    );
  });

  test("an ISO time in the past, or now, is refused", () => {
    expect(() => deadlineFrom({ until: NOW.toISOString() }, NOW)).toThrow(
      "Not a future time"
    );
  });

  test("no limit at all is refused", () => {
    expect(() => deadlineFrom({}, NOW)).toThrow(
      "Give --for <duration> or --until <HH:MM>."
    );
  });
});

describe("the stored run", () => {
  test("starts empty apart from what it was given", () => {
    expect(newRun({ kind: "timebox", scope: "s", until: UNTIL, now: NOW })).toEqual({
      kind: "timebox",
      scope: "s",
      startedAt: NOW.toISOString(),
      until: UNTIL.toISOString(),
      task: null,
      report: null,
      tasks: [],
      fallbacks: [],
      rules: [],
      log: [],
      done: false,
      stopBlocks: 0,
    });
  });

  test("is kept until exactly 12 hours past the deadline", () => {
    start("timebox");
    const limit = UNTIL.getTime() + 12 * HOUR;
    expect(readRun(scopeOf(CWD), new Date(limit))).not.toBeNull();
    expect(readRun(scopeOf(CWD), new Date(limit + 1))).toBeNull();
  });

  test("reads as none when its file is not JSON", () => {
    start("timebox");
    const dir = resolve(home, "memory", "state", "run-mode");
    for (const name of readdirSync(dir)) writeFileSync(resolve(dir, name), "{not json");
    expect(readRun(scopeOf(CWD), BEFORE)).toBeNull();
  });

  test("clearing says whether there was a run to clear", () => {
    start("timebox");
    expect(clearRun(scopeOf(CWD))).toBe(true);
    expect(clearRun(scopeOf(CWD))).toBe(false);
  });

  test("is over from the deadline itself", () => {
    expect(isOver(run("timebox"), new Date(UNTIL.getTime() - 1))).toBe(false);
    expect(isOver(run("timebox"), UNTIL)).toBe(true);
  });

  test("counts a started minute as a minute left, and never below zero", () => {
    expect(minutesLeft(run("timebox"), new Date("2026-10-31T16:29:30Z"))).toBe(1);
    expect(minutesLeft(run("timebox"), AFTER)).toBe(0);
  });
});

describe("unattended rules", () => {
  test("outside a git repository carry no commit rule", () => {
    expect(unattendedRules(false)).toEqual(DEFAULT_UNATTENDED_RULES);
    expect(DEFAULT_UNATTENDED_RULES.join(" ")).not.toMatch(/commit|branch/i);
  });

  test("in a git repository add the commit rule, and the user's rules come last", () => {
    expect(unattendedRules(true, ["no downloads"])).toEqual([
      ...DEFAULT_UNATTENDED_RULES,
      GIT_RULE,
      "no downloads",
    ]);
  });
});

describe("describeRun", () => {
  test("prints every part of an unattended run in order", () => {
    const full = run("unattended", {
      task: "night",
      report: "report.md",
      rules: ["never ask"],
      tasks: ["fix parser", "add tests"],
      fallbacks: ["lint"],
      log: [{ at: BEFORE.toISOString(), entry: "parser fixed" }],
      done: true,
    });
    expect(describeRun(full, BEFORE)).toBe(
      [
        "Unattended until 16:30 (20 min left).",
        "Task: night",
        "Report: report.md",
        "Rules:",
        "  1. never ask",
        "Tasks, in order:",
        "  1. fix parser",
        "  2. add tests",
        "Fallbacks:",
        "  1. lint",
        "Log:",
        "  - 16:10 parser fixed",
        "Marked done.",
      ].join("\n")
    );
  });

  test("prints only the time line for a bare time box that ended", () => {
    expect(describeRun(run("timebox"), AFTER)).toBe("Time box ended at 16:30.");
  });
});

describe("refusal messages", () => {
  test("a time box names its task, its report and how to close it", () => {
    start("timebox", { task: "research", report: "r.md" });
    expect(runModeRefusal({ tool: "Bash", command: "ls" }, CWD, AFTER)).toBe(
      "Time box ended at 16:30 (research). Stop working now: report what you found, what is unfinished and what comes next. Finish the report at r.md. Only `pal cli` and edits to the report still run. Then run `pal cli timebox end`."
    );
  });

  test("an ended unattended run is closed with done", () => {
    start("unattended");
    expect(runModeRefusal({ tool: "WebFetch" }, CWD, AFTER)).toBe(
      "Time box ended at 16:30. Stop working now: report what you found, what is unfinished and what comes next. Only `pal cli` and edits to the report still run. Then run `pal cli unattended done`."
    );
  });

  test("a shell call is not a report edit, even when a report is set", () => {
    start("timebox", { report: "r.md" });
    expect(runModeRefusal({ tool: "Bash", command: "ls" }, CWD, AFTER)).not.toBeNull();
  });

  test("a file edit is refused when no report was set", () => {
    start("timebox");
    const edit = { tool: "Edit", filePath: `${CWD}/r.md` };
    expect(runModeRefusal(edit, CWD, AFTER)).not.toBeNull();
  });

  test("questions are matched whatever their case, delegation by its own message", () => {
    start("unattended");
    expect(runModeRefusal({ tool: "ASK_USER" }, CWD, BEFORE)).toBe(
      "Unattended run: nobody can answer. Decide, log it with `pal cli unattended log`, and put the question in the report."
    );
    expect(runModeRefusal({ tool: "Task" }, CWD, BEFORE)).toBe(
      "Unattended run: one process at a time, so no subagents or workflows. Do the step yourself."
    );
  });

  test("a time box before its deadline does not refuse delegation", () => {
    start("timebox");
    expect(runModeRefusal({ tool: "Agent" }, CWD, BEFORE)).toBeNull();
  });
});

describe("stop messages", () => {
  test("before the deadline: the next task, and how to finish", () => {
    start("unattended");
    expect(unattendedStopReason(CWD, BEFORE)).toBe(
      "Unattended until 16:30 (20 min left): the user is not here to take a reply. Log the step you finished, then take the next approved task, or a fallback when none is left. Keep the draft report current. When every task and fallback is finished and the report is written, run `pal cli unattended done`."
    );
  });

  test("after the deadline with no report set", () => {
    start("unattended");
    expect(unattendedStopReason(CWD, AFTER)).toBe(
      "Unattended run ended at 16:30. Finalise the report, then run `pal cli unattended done`."
    );
  });

  test("a time box never holds the stop", () => {
    start("timebox");
    expect(unattendedStopReason(CWD, BEFORE)).toBeNull();
  });
});

describe("prompt and recall text", () => {
  test("a time box with a task", () => {
    start("timebox", { task: "research" });
    expect(runModePromptLine(CWD, BEFORE)).toBe(
      "<system-reminder>Time box until 16:30, 20 min left: research. Stop and report at the deadline.</system-reminder>"
    );
  });

  test("a time box without a task", () => {
    start("timebox");
    expect(runModePromptLine(CWD, BEFORE)).toBe(
      "<system-reminder>Time box until 16:30, 20 min left. Stop and report at the deadline.</system-reminder>"
    );
  });

  test("an unattended run when the user writes", () => {
    start("unattended");
    expect(runModePromptLine(CWD, BEFORE)).toBe(
      "<system-reminder>Unattended run until 16:30, but the user just wrote: answer them. If they are back, run `pal cli unattended end`.</system-reminder>"
    );
  });

  test("the recall wraps the whole run", () => {
    start("timebox");
    expect(runModeRecall(CWD, BEFORE)).toBe(
      "<system-reminder>\n## Active run — re-read before doing anything else\nTime box until 16:30 (20 min left).\n</system-reminder>"
    );
  });
});
