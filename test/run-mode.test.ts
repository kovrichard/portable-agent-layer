import { beforeEach, describe, expect, test } from "bun:test";
import { scopeOf } from "../src/hooks/lib/progress-tree";
import {
  deadlineFrom,
  newRun,
  type Run,
  readRun,
  writeRun,
} from "../src/hooks/lib/run-mode";
import {
  MAX_STOP_BLOCKS,
  runModePromptLine,
  runModeRecall,
  runModeRefusal,
  unattendedStopReason,
} from "../src/hooks/lib/run-mode-gate";
import { decideRefusal } from "../src/hooks/lib/security-gate";
import { freshTestDir } from "./lib/test-home";

const CWD = "/work/run-app";
const OTHER_CWD = "/work/other-app";
const NOW = new Date("2026-10-31T16:00:00Z");
const BEFORE = new Date("2026-10-31T16:10:00Z");
const AFTER = new Date("2026-10-31T16:40:00Z");
const UNTIL = new Date("2026-10-31T16:30:00Z");

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
});

function start(kind: Run["kind"], extra: Partial<Run> = {}, cwd = CWD): Run {
  const scope = scopeOf(cwd);
  const run = { ...newRun({ kind, scope, until: UNTIL, now: NOW }), ...extra };
  writeRun(run);
  return run;
}

describe("deadlineFrom", () => {
  test("adds a duration to now", () => {
    expect(deadlineFrom({ for: "1h30m" }, NOW).toISOString()).toBe(
      "2026-10-31T17:30:00.000Z"
    );
  });

  test("takes the next such local time, today or tomorrow", () => {
    expect(deadlineFrom({ until: "18:00" }, NOW).toISOString()).toBe(
      "2026-10-31T18:00:00.000Z"
    );
    expect(deadlineFrom({ until: "15:00" }, NOW).toISOString()).toBe(
      "2026-11-01T15:00:00.000Z"
    );
  });

  test("refuses a duration it cannot read", () => {
    expect(() => deadlineFrom({ for: "7x" }, NOW)).toThrow("Not a duration");
    expect(() => deadlineFrom({ for: "0m" }, NOW)).toThrow("Not a duration");
  });

  test("refuses an hour past 23", () => {
    expect(() => deadlineFrom({ until: "25:00" }, NOW)).toThrow("Not a future time");
  });
});

describe("a stored run", () => {
  test("is forgotten 12 hours after its deadline, so a later session is not held by it", () => {
    start("timebox");
    expect(readRun(scopeOf(CWD), new Date("2026-10-31T20:00:00Z"))).not.toBeNull();
    expect(readRun(scopeOf(CWD), new Date("2026-11-01T05:00:00Z"))).toBeNull();
  });
});

describe("a time box", () => {
  test("lets work through before the deadline", () => {
    start("timebox");
    expect(runModeRefusal({ tool: "Bash", command: "bun test" }, CWD, BEFORE)).toBeNull();
  });

  test("refuses work after the deadline, naming when it ended", () => {
    start("timebox", { task: "research caching" });
    const refusal = runModeRefusal({ tool: "WebSearch" }, CWD, AFTER);
    expect(refusal).toContain("Time box ended at");
    expect(refusal).toContain("research caching");
  });

  test("still runs pal cli after the deadline, piped into tail too", () => {
    start("timebox");
    for (const command of ["pal cli timebox end", "pal cli progress show 2>&1 | tail -3"])
      expect(runModeRefusal({ tool: "Bash", command }, CWD, AFTER)).toBeNull();
  });

  test("refuses other work chained after pal cli", () => {
    start("timebox");
    const command = "pal cli timebox status && bun test";
    expect(runModeRefusal({ tool: "Bash", command }, CWD, AFTER)).not.toBeNull();
  });

  test("still lets the report be written after the deadline, and nothing else", () => {
    start("timebox", { report: "notes/report.md" });
    const report = { tool: "Write", filePath: `${CWD}/notes/report.md` };
    const other = { tool: "Write", filePath: `${CWD}/src/app.ts` };
    expect(runModeRefusal(report, CWD, AFTER)).toBeNull();
    expect(runModeRefusal(other, CWD, AFTER)).not.toBeNull();
  });

  test("does not refuse questions: the user is there", () => {
    start("timebox");
    expect(runModeRefusal({ tool: "AskUserQuestion" }, CWD, BEFORE)).toBeNull();
  });
});

describe("an unattended run", () => {
  test("refuses questions and delegation before the deadline", () => {
    start("unattended");
    for (const tool of ["AskUserQuestion", "Agent", "Workflow"])
      expect(runModeRefusal({ tool }, CWD, BEFORE)).toContain("Unattended run");
    expect(runModeRefusal({ tool: "Bash", command: "bun test" }, CWD, BEFORE)).toBeNull();
  });

  test("keeps the agent from stopping while work is left, and counts each block", () => {
    start("unattended");
    expect(unattendedStopReason(CWD, BEFORE)).toContain("next approved task");
    expect(readRun(scopeOf(CWD), BEFORE)?.stopBlocks).toBe(1);
  });

  test("asks for the report when it stops after the deadline", () => {
    start("unattended", { report: "report.md" });
    expect(unattendedStopReason(CWD, AFTER)).toContain(
      "Finalise the report at report.md"
    );
  });

  test("lets the agent stop once it is done", () => {
    start("unattended", { done: true });
    expect(unattendedStopReason(CWD, BEFORE)).toBeNull();
  });

  test("lets the agent stop after the block limit, so it cannot loop forever", () => {
    start("unattended", { stopBlocks: MAX_STOP_BLOCKS });
    expect(unattendedStopReason(CWD, BEFORE)).toBeNull();
  });

  test("restores its rules, tasks and log after a compaction", () => {
    start("unattended", {
      rules: ["never ask"],
      tasks: ["fix the parser"],
      log: [{ at: BEFORE.toISOString(), entry: "parser fixed, abc123" }],
    });
    const recall = runModeRecall(CWD, BEFORE) ?? "";
    for (const part of ["never ask", "fix the parser", "parser fixed, abc123"])
      expect(recall).toContain(part);
  });
});

describe("the prompt line", () => {
  test("says how much time is left", () => {
    start("timebox");
    expect(runModePromptLine(CWD, BEFORE)).toContain("20 min left");
  });

  test("clears a run once the user writes after its deadline", () => {
    start("timebox");
    expect(runModePromptLine(CWD, AFTER)).toBeNull();
    expect(readRun(scopeOf(CWD), AFTER)).toBeNull();
  });
});

describe("with no run, or a run in another folder", () => {
  test("nothing is refused, held or added", () => {
    start("unattended", {}, OTHER_CWD);
    expect(runModeRefusal({ tool: "AskUserQuestion" }, CWD, BEFORE)).toBeNull();
    expect(unattendedStopReason(CWD, BEFORE)).toBeNull();
    expect(runModePromptLine(CWD, BEFORE)).toBeNull();
    expect(runModeRecall(CWD, BEFORE)).toBeNull();
  });
});

describe("the security gate", () => {
  test("carries the run's refusal for a tool it otherwise ignores", () => {
    const now = new Date();
    writeRun(
      newRun({
        kind: "unattended",
        scope: scopeOf(CWD),
        until: new Date(now.getTime() + 3_600_000),
        now,
      })
    );
    const refusal = decideRefusal(
      { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: {} },
      CWD
    );
    expect(refusal?.reason).toBe("run mode");
    expect(refusal?.message).toContain("nobody can answer");
  });
});
