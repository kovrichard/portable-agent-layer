import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { patternsCommand } from "../src/cli/patterns";
import { appendEvent } from "../src/hooks/lib/events";
import { runCommand } from "../src/tools/lib/command";
import { projectActivity } from "../src/tools/lib/patterns/activity";
import { contextSwitches, dayShape } from "../src/tools/lib/patterns/days";
import { focusBlocks } from "../src/tools/lib/patterns/focus";
import { projectProfiles } from "../src/tools/lib/patterns/profiles";
import {
  daysLines,
  focusLines,
  momentumLines,
  projectsLines,
} from "../src/tools/lib/patterns/render";
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

const minutesIn = (
  type: "turn" | "commit" | "model_call",
  project: string,
  minute: number
) => at(type, project, new Date(Date.UTC(2026, 5, 1, 6) + minute * 60_000).toISOString());

describe("focus blocks", () => {
  test("nothing logged has no focus", () => {
    expect(focusBlocks([])).toBeNull();
  });

  test("90 minutes on one project with no gap over 30 count, and the longest is named", () => {
    const focus = focusBlocks(
      activityOf(
        ...[0, 30, 60, 90].map((m) => minutesIn("turn", "a", m)),
        ...[200, 230, 261, 290].map((m) => minutesIn("turn", "b", m)),
        ...[400, 430, 460, 489].map((m) => minutesIn("turn", "c", m)),
        ...[600, 630, 660, 690, 720].map((m) => minutesIn("commit", "d", m))
      )
    );
    expect(focus).toEqual({
      blocks: 2,
      minutes: 90 + 120,
      longest: { value: 120, label: "d, 2026-06-01" },
    });
  });

  test("another session's model calls leave a block alone; the user moving there ends it", () => {
    const focus = focusBlocks(
      activityOf(
        minutesIn("turn", "a", 0),
        minutesIn("model_call", "b", 20),
        minutesIn("model_call", "a", 25),
        minutesIn("turn", "a", 50),
        minutesIn("turn", "a", 75),
        minutesIn("turn", "a", 95),
        minutesIn("turn", "b", 100),
        minutesIn("turn", "b", 130),
        minutesIn("turn", "a", 140),
        minutesIn("turn", "b", 190)
      )
    );
    expect(focus).toEqual({
      blocks: 1,
      minutes: 95,
      longest: { value: 95, label: "a, 2026-06-01" },
    });
  });

  test("activity with no block long enough has none", () => {
    expect(focusBlocks(activityOf(minutesIn("turn", "a", 0)))).toEqual({
      blocks: 0,
      minutes: 0,
      longest: null,
    });
  });
});

describe("focus as printed", () => {
  test("blocks print in hours and minutes, rounded to the minute", () => {
    expect(
      focusLines({
        blocks: 1200,
        minutes: 119.6,
        longest: { value: 90.2, label: "a, 2026-06-01" },
      })
    ).toEqual([
      "\n  Focus\n",
      "    focus blocks         1,200, 2h 00m in all",
      "    longest              1h 30m (a, 2026-06-01)",
    ]);
  });

  test("no block says none; no activity says unknown", () => {
    expect(focusLines({ blocks: 0, minutes: 0, longest: null })[2]).toBe(
      "    longest              none"
    );
    expect(focusLines(null).slice(1)).toEqual([
      "    focus blocks         unknown",
      "    longest              unknown",
    ]);
  });
});

describe("project profiles", () => {
  test("each project's busiest local hour and weekday count active hours, most worked-on first", () => {
    const profiles = projectProfiles(
      activityOf(
        ...[1, 2, 3, 4, 5].map((m) => at("commit", "a", `2026-06-01T08:0${m}:00.000Z`)),
        at("commit", "a", "2026-06-02T13:00:00.000Z"),
        at("commit", "a", "2026-06-03T13:00:00.000Z"),
        at("commit", "b", "2026-06-06T22:30:00.000Z"),
        at("commit", "c", "2026-06-06T10:00:00.000Z")
      )
    );
    expect(
      profiles.map(({ project, activeDays, hour, weekday }) => ({
        project,
        activeDays,
        hour,
        weekday,
      }))
    ).toEqual([
      { project: "a", activeDays: 3, hour: "15:00", weekday: "Mon" },
      { project: "b", activeDays: 1, hour: "00:00", weekday: "Sun" },
      { project: "c", activeDays: 1, hour: "12:00", weekday: "Sat" },
    ]);
  });

  test("the agent and channel mix is counted on the project's messages", () => {
    const [profile] = projectProfiles(
      activityOf(
        event("turn", {}, { project: "a", runtime: "cursor", channel: "discord-mobile" }),
        event("turn", {}, { project: "a", runtime: "claude" }),
        event("turn", {}, { project: "a", runtime: "claude" }),
        event("commit", {}, { project: "a", runtime: "git" }),
        event("model_call", {}, { project: "a", runtime: "codex" })
      )
    );
    expect(profile.agents).toEqual([
      { name: "Claude Code", count: 2 },
      { name: "Cursor", count: 1 },
    ]);
    expect(profile.channels).toEqual([
      { name: "terminal", count: 2 },
      { name: "discord-mobile", count: 1 },
    ]);
  });
});

describe("projects as printed", () => {
  test("each project prints its days, busiest hour and mix", () => {
    expect(
      projectsLines([
        {
          project: "pal",
          activeDays: 1,
          hour: "21:00",
          weekday: "Tue",
          agents: [{ name: "Claude Code", count: 1200 }],
          channels: [],
        },
      ])
    ).toEqual([
      "\n  Projects\n",
      "    pal                  1 day, most at 21:00 on Tue",
      "      agents             Claude Code 1,200",
      "      channels           unknown",
    ]);
  });

  test("no activity says unknown", () => {
    expect(projectsLines([]).slice(1)).toEqual(["    projects             unknown"]);
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
