import { beforeEach, describe, expect, test } from "bun:test";
import { scopeOf } from "../src/hooks/lib/progress-tree";
import {
  addSchedule,
  dueSchedules,
  MAX_TEXT,
  newSchedule,
  openWindowDay,
  parseDays,
  type Repeat,
  readSchedules,
  removeSchedule,
  type Schedule,
  scheduledPromptsReminder,
  USER_SCOPE,
} from "../src/hooks/lib/scheduled-prompts";
import { freshTestDir } from "./lib/test-home";

const HERE = "/work/game";
const ELSEWHERE = "/work/other";
const SAT_2000 = new Date("2026-10-31T20:00:00Z");
const SAT_1959 = new Date("2026-10-31T19:59:00Z");
const SAT_2330 = new Date("2026-10-31T23:30:00Z");
const SUN_0130 = new Date("2026-11-01T01:30:00Z");
const SUN_2100 = new Date("2026-11-01T21:00:00Z");

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
});

function schedule(
  fields: Partial<{
    scope: string;
    from: string;
    to: string;
    days: string;
    repeat: Repeat;
    text: string;
  }> = {}
): Schedule {
  const made = newSchedule({
    scope: scopeOf(HERE),
    from: "20:00",
    text: "suggest night tasks",
    ...fields,
  });
  addSchedule(made);
  return made;
}

function dueIds(now: Date, session = "s1", cwd = HERE): string[] {
  return dueSchedules(cwd, session, now).map((s) => s.id);
}

describe("a schedule's fields", () => {
  test("default to once a day until midnight, on every weekday", () => {
    expect(newSchedule({ scope: USER_SCOPE, from: "20:00", text: " hi " })).toMatchObject(
      {
        scope: USER_SCOPE,
        from: "20:00",
        to: null,
        days: null,
        repeat: "daily",
        text: "hi",
      }
    );
  });

  test.each([
    [{ from: "25:00" }, 'Not a time of day: "25:00". Use HH:MM.'],
    [{ from: "24:00" }, "A window cannot start at 24:00; use 00:00."],
    [{ from: "20:00", to: "20:00" }, "The window starts and ends at the same time."],
    [{ from: "20:00", text: "  " }, "Give the prompt text."],
    [{ from: "20:00", days: "funday" }, 'Not a weekday: "funday". Use mon, tue, … sun.'],
  ])("%p is refused", (fields, message) => {
    expect(() => newSchedule({ scope: USER_SCOPE, text: "x", ...fields })).toThrow(
      message
    );
  });

  test("text over the cap is refused", () => {
    const text = "x".repeat(MAX_TEXT + 1);
    expect(() => newSchedule({ scope: USER_SCOPE, from: "20:00", text })).toThrow(
      `The prompt is ${MAX_TEXT + 1} characters; keep it under ${MAX_TEXT}.`
    );
  });

  test.each([
    ["mon-fri", [0, 1, 2, 3, 4]],
    ["sat,sun", [5, 6]],
    ["fri-mon", [0, 4, 5, 6]],
    ["Monday,wed", [0, 2]],
  ])("days %p are weekdays %p", (spec, days) => {
    expect(parseDays(spec)).toEqual(days);
  });

  test("are stored, and removed by id", () => {
    const kept = schedule();
    const gone = schedule({ from: "08:00" });
    expect(removeSchedule(gone.id)).toBe(true);
    expect(removeSchedule(gone.id)).toBe(false);
    expect(readSchedules()).toEqual([kept]);
  });
});

describe("the window", () => {
  test("opens at its start minute and closes at midnight by default", () => {
    const s = schedule();
    expect(openWindowDay(s, SAT_1959)).toBeNull();
    expect(openWindowDay(s, SAT_2000)).toBe("2026-10-31");
    expect(openWindowDay(s, SUN_0130)).toBeNull();
  });

  test("closes at its end minute", () => {
    const s = schedule({ from: "08:00", to: "20:00" });
    expect(openWindowDay(s, SAT_1959)).toBe("2026-10-31");
    expect(openWindowDay(s, SAT_2000)).toBeNull();
  });

  test("past midnight belongs to the day it opened", () => {
    const s = schedule({ to: "02:00" });
    expect(openWindowDay(s, SAT_2330)).toBe("2026-10-31");
    expect(openWindowDay(s, SUN_0130)).toBe("2026-10-31");
    expect(openWindowDay(s, new Date("2026-11-01T02:00:00Z"))).toBeNull();
  });

  test("past midnight counts the weekday it opened on", () => {
    const s = schedule({ to: "02:00", days: "sat" });
    expect(openWindowDay(s, SUN_0130)).toBe("2026-10-31");
    expect(openWindowDay(s, SUN_2100)).toBeNull();
  });

  test("stays shut on other weekdays", () => {
    const s = schedule({ days: "mon-fri" });
    expect(openWindowDay(s, SAT_2000)).toBeNull();
  });
});

describe("firing", () => {
  test("a daily schedule fires once per day, across sessions", () => {
    const s = schedule();
    expect(dueIds(SAT_2000, "s1")).toEqual([s.id]);
    expect(dueIds(SAT_2330, "s2")).toEqual([]);
    expect(dueIds(SUN_2100, "s2")).toEqual([s.id]);
  });

  test("past midnight it does not fire again for the same evening", () => {
    const s = schedule({ to: "02:00" });
    expect(dueIds(SAT_2330)).toEqual([s.id]);
    expect(dueIds(SUN_0130)).toEqual([]);
  });

  test("an every-session schedule fires once in each session", () => {
    const s = schedule({ repeat: "every-session" });
    expect(dueIds(SAT_2000, "s1")).toEqual([s.id]);
    expect(dueIds(SAT_2330, "s1")).toEqual([]);
    expect(dueIds(SAT_2330, "s2")).toEqual([s.id]);
  });

  test("an every-session schedule with no session id fires once a day", () => {
    const s = schedule({ repeat: "every-session" });
    expect(dueSchedules(HERE, undefined, SAT_2000).map((d) => d.id)).toEqual([s.id]);
    expect(dueSchedules(HERE, undefined, SAT_2330)).toEqual([]);
  });

  test("an every-prompt schedule fires on every prompt in the window", () => {
    const s = schedule({ repeat: "every-prompt" });
    expect(dueIds(SAT_2000)).toEqual([s.id]);
    expect(dueIds(SAT_2330)).toEqual([s.id]);
    expect(dueIds(SUN_0130)).toEqual([]);
  });

  test("a project schedule fires only in its project, a user one everywhere", () => {
    const project = schedule();
    const user = schedule({ scope: USER_SCOPE });
    expect(dueIds(SAT_2000, "s1", ELSEWHERE)).toEqual([user.id]);
    expect(dueIds(SAT_2000, "s1", HERE)).toEqual([project.id]);
  });

  test("a schedule that is not due is not marked, so it fires when it opens", () => {
    const s = schedule();
    expect(dueIds(SAT_1959)).toEqual([]);
    expect(dueIds(SAT_2000)).toEqual([s.id]);
  });
});

describe("the reminder", () => {
  test("lists each due schedule with its window and scope", () => {
    schedule({ to: "23:00" });
    schedule({
      scope: USER_SCOPE,
      from: "19:00",
      repeat: "every-prompt",
      text: "keep it short",
    });
    expect(scheduledPromptsReminder(HERE, "s1", SAT_2000)).toBe(
      [
        "<system-reminder>",
        "The user scheduled these for this time of day; act on them in this reply:",
        `- (20:00–23:00, ${scopeOf(HERE)}) suggest night tasks`,
        "- (19:00–24:00, user) keep it short",
        "</system-reminder>",
      ].join("\n")
    );
  });

  test("is null when nothing is due", () => {
    schedule();
    expect(scheduledPromptsReminder(HERE, "s1", SAT_1959)).toBeNull();
  });
});
