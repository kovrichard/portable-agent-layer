import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { patternsCommand } from "../src/cli/patterns";
import { appendEvent } from "../src/hooks/lib/events";
import { runCommand } from "../src/tools/lib/command";
import { projectActivity } from "../src/tools/lib/patterns/activity";
import { contextSwitches, dayShape } from "../src/tools/lib/patterns/days";
import { daysLines, momentumLines } from "../src/tools/lib/patterns/render";
import { currentSprint, quietAfterBurst } from "../src/tools/lib/patterns/sprint";
import { budapestHome, event } from "./lib/wrapped-events";

beforeEach(() => {
  budapestHome(import.meta.file);
});

const work = (project: string, day: string) =>
  event("commit", {}, { project, ts: `${day}T10:00:00.000Z` });

const activityOf = (...events: ReturnType<typeof event>[]) => projectActivity(events);

describe("current sprint", () => {
  test("nothing logged has no sprint", () => {
    expect(currentSprint([])).toBeNull();
  });

  test("the longest run on the latest day wins, counted in days the user worked", () => {
    const activity = activityOf(
      work("a", "2026-06-01"),
      work("b", "2026-06-02"),
      work("a", "2026-06-04"),
      work("b", "2026-06-04"),
      work("b", "2026-06-05"),
      work("a", "2026-06-05")
    );
    expect(currentSprint(activity)).toEqual({
      project: "b",
      days: 3,
      since: "2026-06-02",
    });
  });

  test("a tie goes to the first name", () => {
    const activity = activityOf(work("b", "2026-06-01"), work("a", "2026-06-01"));
    expect(currentSprint(activity)?.project).toBe("a");
  });

  test("days are local, and only the user's own work in a project counts", () => {
    const activity = activityOf(
      work("a", "2026-06-01"),
      event("commit", {}, { project: "b", ts: "2026-06-01T22:30:00.000Z" }),
      event(
        "model_call",
        { entrypoint: "sdk-cli" },
        { project: "c", ts: "2026-06-03T10:00:00.000Z" }
      ),
      event("rating", {}, { project: "c", ts: "2026-06-03T10:00:00.000Z" }),
      event("commit", {}, { ts: "2026-06-03T10:00:00.000Z" })
    );
    expect(currentSprint(activity)).toEqual({
      project: "b",
      days: 1,
      since: "2026-06-02",
    });
  });
});

describe("quiet after a burst", () => {
  test("3 active days within 7, then 14 days without any, latest first", () => {
    const activity = activityOf(
      ...["2026-06-01", "2026-06-03", "2026-06-07"].map((d) => work("burst", d)),
      ...["2026-06-01", "2026-06-05", "2026-06-08"].map((d) => work("spread", d)),
      ...["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-17"].map((d) =>
        work("edge", d)
      ),
      ...["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"].map((d) =>
        work("recent", d)
      )
    );
    expect(quietAfterBurst(activity, "2026-07-01")).toEqual([
      { project: "edge", lastActive: "2026-06-17", quietDays: 14, burstDays: 3 },
      { project: "burst", lastActive: "2026-06-07", quietDays: 24, burstDays: 3 },
    ]);
  });
});

const at = (type: "turn" | "commit" | "model_call", project: string, ts: string) =>
  event(type, {}, { project, ts });

describe("days", () => {
  test("a day is on one project or on several", () => {
    const activity = activityOf(
      work("a", "2026-06-01"),
      work("a", "2026-06-01"),
      work("a", "2026-06-02"),
      work("b", "2026-06-02"),
      work("b", "2026-06-03")
    );
    expect(dayShape(activity)).toEqual({ oneProject: 2, manyProjects: 1 });
  });

  test("a switch is the user's next message or commit landing in another project the same day", () => {
    const activity = activityOf(
      at("turn", "a", "2026-06-01T08:00:00.000Z"),
      at("model_call", "b", "2026-06-01T08:01:00.000Z"),
      at("commit", "a", "2026-06-01T08:02:00.000Z"),
      at("turn", "b", "2026-06-01T08:03:00.000Z"),
      at("turn", "a", "2026-06-01T08:04:00.000Z"),
      at("turn", "b", "2026-06-02T08:00:00.000Z"),
      at("turn", "b", "2026-06-02T08:01:00.000Z"),
      at("turn", "a", "2026-06-03T08:00:00.000Z"),
      at("commit", "b", "2026-06-03T08:01:00.000Z"),
      at("turn", "c", "2026-06-03T08:02:00.000Z")
    );
    expect(contextSwitches(activity)).toEqual({
      perDay: 4 / 3,
      mostInADay: { value: 2, label: "2026-06-01" },
    });
  });

  test("nothing logged has no switches and no days", () => {
    expect(contextSwitches([])).toBeNull();
    expect(dayShape([])).toEqual({ oneProject: 0, manyProjects: 0 });
  });
});

describe("days as printed", () => {
  test("day shape and switches print with their share and busiest day", () => {
    expect(
      daysLines(
        { oneProject: 3, manyProjects: 1 },
        { perDay: 1.25, mostInADay: { value: 1200, label: "2026-06-01" } }
      )
    ).toEqual([
      "\n  Days\n",
      "    project days         3 days on one project, 1 day on several (75% focused)",
      "    context switches     1.3 a day, at most 1,200 (2026-06-01)",
    ]);
  });

  test("with no activity both are unknown", () => {
    expect(daysLines({ oneProject: 0, manyProjects: 0 }, null).slice(1)).toEqual([
      "    project days         unknown",
      "    context switches     unknown",
    ]);
  });
});

describe("momentum as printed", () => {
  test("the sprint and the quiet projects print with their days", () => {
    expect(
      momentumLines({ project: "pal", days: 1, since: "2026-10-13" }, [
        { project: "a", lastActive: "2026-09-01", quietDays: 42, burstDays: 5 },
        { project: "b", lastActive: "2026-08-01", quietDays: 1, burstDays: 3 },
      ])
    ).toEqual([
      "\n  Momentum\n",
      "    current sprint       pal, 1 day of work since 2026-10-13",
      "    quiet after a burst  a (quiet 42 days) · b (quiet 1 day)",
    ]);
  });

  test("no quiet project says none; no activity at all says unknown", () => {
    expect(momentumLines({ project: "pal", days: 2, since: "2026-10-12" }, [])[2]).toBe(
      "    quiet after a burst  none"
    );
    expect(momentumLines(null, []).slice(1)).toEqual([
      "    current sprint       unknown",
      "    quiet after a burst  unknown",
    ]);
  });
});

async function patterns(): Promise<string> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await runCommand(patternsCommand, [], ["pal", "cli", "patterns"])).toBe(0);
    return log.mock.calls.map((c) => c.join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
}

describe("pal cli patterns", () => {
  test("prints the patterns read from the event log", async () => {
    appendEvent("commit", {}, { project: "pal", ts: "2026-06-01T10:00:00.000Z" });
    const text = await patterns();
    expect(text).toContain("PAL Patterns");
    expect(text).toContain("current sprint       pal, 1 day of work since 2026-06-01");
  });
});
