import { beforeEach, describe, expect, test } from "bun:test";
import { wrappedRecords } from "../src/tools/lib/wrapped/records";
import { recordsLines } from "../src/tools/lib/wrapped/render";
import { budapestHome, event } from "./lib/wrapped-events";

beforeEach(() => {
  budapestHome(import.meta.file);
});

const at = (ts: string) => ({ ts });

describe("records", () => {
  test("nothing logged holds no record", () => {
    expect(Object.values(wrappedRecords([]))).toEqual(new Array(7).fill(null));
  });

  test("projects registered in a day count registrations on the local day only", () => {
    const records = wrappedRecords([
      event("project", { change: "registered" }, at("2026-03-01T23:30:00.000Z")),
      event("project", { change: "registered" }, at("2026-03-02T10:00:00.000Z")),
      event("project", { change: "archived" }, at("2026-03-02T11:00:00.000Z")),
      event("project", { change: "registered" }, at("2026-03-05T10:00:00.000Z")),
    ]);
    expect(records.projectsRegisteredInADay).toEqual({ value: 2, label: "2026-03-02" });
  });

  test("commits in a day are counted per local day", () => {
    const records = wrappedRecords([
      event("commit", {}, at("2026-03-01T10:00:00.000Z")),
      event("commit", {}, at("2026-03-02T10:00:00.000Z")),
      event("commit", {}, at("2026-03-02T11:00:00.000Z")),
      event("commit", {}, at("2026-03-02T23:30:00.000Z")),
    ]);
    expect(records.commitsInADay).toEqual({ value: 2, label: "2026-03-02" });
  });

  test("a tie keeps the record that was set first", () => {
    const records = wrappedRecords([
      event("commit", {}, at("2026-03-01T10:00:00.000Z")),
      event("commit", {}, at("2026-03-02T10:00:00.000Z")),
    ]);
    expect(records.commitsInADay?.label).toBe("2026-03-01");
  });

  test("the longest project spans its first to last active day, both counted", () => {
    const records = wrappedRecords([
      event("commit", {}, { project: "short", ts: "2026-03-01T10:00:00.000Z" }),
      event("turn", {}, { project: "long", ts: "2026-03-05T10:00:00.000Z" }),
      event("turn", {}, { project: "long", ts: "2026-03-01T10:00:00.000Z" }),
      event("commit", {}, { project: "long", ts: "2026-03-10T10:00:00.000Z" }),
      event("turn", {}, { project: "long", ts: "2026-03-03T10:00:00.000Z" }),
      event("commit", {}, at("2026-01-01T10:00:00.000Z")),
      event("commit", {}, at("2026-12-01T10:00:00.000Z")),
    ]);
    expect(records.longestProject).toEqual({ value: 10, label: "long" });
  });

  test("a streak is consecutive local days with the user's own activity", () => {
    const spawned = { entrypoint: "sdk-cli" };
    const records = wrappedRecords([
      event("commit", {}, at("2026-03-06T10:00:00.000Z")),
      event("turn", {}, at("2026-03-02T10:00:00.000Z")),
      event("commit", {}, at("2026-03-01T10:00:00.000Z")),
      event("model_call", { entrypoint: "cli" }, at("2026-03-03T10:00:00.000Z")),
      event("model_call", spawned, at("2026-03-04T10:00:00.000Z")),
      event("rating", {}, at("2026-03-04T11:00:00.000Z")),
      event("commit", {}, at("2026-03-05T10:00:00.000Z")),
    ]);
    expect(records.longestStreak).toEqual({ value: 3, label: "2026-03-01 → 2026-03-03" });
  });

  test("a single active day is a one-day streak", () => {
    const records = wrappedRecords([event("commit")]);
    expect(records.longestStreak).toEqual({ value: 1, label: "2026-06-01 → 2026-06-01" });
  });

  test("the longest agent-alone run is the slowest reply", () => {
    const records = wrappedRecords([
      event("reply", { latencySec: 30 }, at("2026-03-01T10:00:00.000Z")),
      event("reply", { latencySec: 2280 }, at("2026-03-02T10:00:00.000Z")),
      event("reply", { latencySec: null }, at("2026-03-03T10:00:00.000Z")),
    ]);
    expect(records.longestAgentRun).toEqual({ value: 2280, label: "2026-03-02" });
  });

  test("a reply with no latency holds no record", () => {
    expect(
      wrappedRecords([event("reply", { latencySec: null })]).longestAgentRun
    ).toBeNull();
  });
});

describe("records within a turn", () => {
  const where = { session: "s", project: "pal" };
  const call = (costUsd: number | null, ts: string) =>
    event("model_call", { costUsd }, { ...where, runtime: "opencode", ts });

  test("a turn costs every call until the next turn of its session", () => {
    const records = wrappedRecords([
      call(0.25, "2026-03-01T11:01:00.000Z"),
      call(9, "2026-03-01T09:00:00.000Z"),
      event("turn", {}, { ...where, ts: "2026-03-01T11:00:00.000Z" }),
      call(0.1, "2026-03-01T10:01:00.000Z"),
      event("turn", {}, { ...where, ts: "2026-03-01T10:00:00.000Z" }),
      call(0.2, "2026-03-01T10:02:00.000Z"),
      event("model_call", { costUsd: 5 }, { session: "other", runtime: "opencode" }),
    ]);
    expect(records.mostExpensiveTurn?.value).toBeCloseTo(0.3);
    expect(records.mostExpensiveTurn?.label).toBe("2026-03-01, pal");
  });

  test("a turn with a call PAL cannot price is left out, not undercounted", () => {
    const records = wrappedRecords([
      event("turn", {}, { ...where, ts: "2026-03-01T10:00:00.000Z" }),
      call(0.1, "2026-03-01T10:01:00.000Z"),
      event("turn", {}, { ...where, ts: "2026-03-01T11:00:00.000Z" }),
      call(5, "2026-03-01T11:01:00.000Z"),
      call(null, "2026-03-01T11:02:00.000Z"),
      event("turn", {}, { ...where, ts: "2026-03-01T12:00:00.000Z" }),
    ]);
    expect(records.mostExpensiveTurn?.value).toBeCloseTo(0.1);
  });

  test("turns with no calls, or only unpriced ones, hold no costliest turn", () => {
    const records = wrappedRecords([
      event("turn", {}, { ...where, ts: "2026-03-01T10:00:00.000Z" }),
      event("turn", {}, { ...where, ts: "2026-03-01T11:00:00.000Z" }),
      call(null, "2026-03-01T11:01:00.000Z"),
    ]);
    expect(records.mostExpensiveTurn).toBeNull();
  });

  test("the biggest tool burst is the most tool calls in one turn", () => {
    const tool = (ts: string) => event("tool_call", {}, { session: "s", ts });
    const records = wrappedRecords([
      event("turn", {}, { session: "s", ts: "2026-03-01T10:00:00.000Z" }),
      tool("2026-03-01T10:01:00.000Z"),
      event("turn", {}, { session: "s", ts: "2026-03-02T10:00:00.000Z" }),
      tool("2026-03-02T10:01:00.000Z"),
      tool("2026-03-02T10:02:00.000Z"),
      event("turn", {}, { ts: "2026-03-03T10:00:00.000Z" }),
      ...[1, 2, 3].map((m) =>
        event("tool_call", {}, { ts: `2026-03-03T10:0${m}:00.000Z` })
      ),
    ]);
    expect(records.biggestToolBurst).toEqual({ value: 2, label: "2026-03-02" });
  });

  test("turns without tool calls hold no burst", () => {
    const records = wrappedRecords([event("turn", {}, { session: "s" })]);
    expect(records.biggestToolBurst).toBeNull();
  });
});

describe("the records as printed", () => {
  test("each record shows its value and where it happened; a missing one is unknown", () => {
    expect(
      recordsLines({
        projectsRegisteredInADay: { value: 4, label: "2026-07-28" },
        commitsInADay: { value: 1094, label: "2026-10-12" },
        longestProject: { value: 1, label: "pal" },
        longestStreak: { value: 39, label: "2026-08-03 → 2026-09-10" },
        longestAgentRun: { value: 2280, label: "2026-10-12" },
        mostExpensiveTurn: null,
        biggestToolBurst: { value: 1673, label: "2026-10-12, pal" },
      })
    ).toEqual([
      "\n  Records\n",
      "    most projects registered in a day    4  (2026-07-28)",
      "    most commits in a day                1,094  (2026-10-12)",
      "    longest project                      1 day  (pal)",
      "    longest streak                       39 days  (2026-08-03 → 2026-09-10)",
      "    longest agent-alone run              38m  (2026-10-12)",
      "    most expensive turn                  unknown",
      "    biggest tool burst                   1,673 tool calls  (2026-10-12, pal)",
    ]);
  });
});
