import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { costCommand } from "../src/cli/cost";
import { appendEvent } from "../src/hooks/lib/events";
import { runCommand } from "../src/tools/lib/command";
import { leaderboards } from "../src/tools/lib/cost/leaderboards";
import { leaderboardLines } from "../src/tools/lib/cost/render";
import { budapestHome, event } from "./lib/wrapped-events";

beforeEach(() => {
  budapestHome(import.meta.file);
});

const call = (costUsd: number | null, envelope: Parameters<typeof event>[2] = {}) =>
  event("model_call", costUsd === null ? {} : { costUsd }, {
    runtime: costUsd === null ? "copilot" : "opencode",
    ...envelope,
  });

describe("leaderboards", () => {
  test("nothing logged has no board", () => {
    expect(leaderboards([])).toEqual({ projects: [], sessions: [], days: [], turns: [] });
  });

  test("projects sum their calls, unpriced ones counted apart, top five, ties by name", () => {
    const boards = leaderboards([
      ...["a", "b", "c", "d", "e"].map((project) => call(1, { project })),
      call(1, { project: "f" }),
      call(2, { project: "c" }),
      call(null, { project: "c" }),
      call(0.5),
    ]);
    expect(boards.projects).toEqual([
      { label: "c", cost: 3, unpriced: 1 },
      { label: "a", cost: 1, unpriced: 0 },
      { label: "b", cost: 1, unpriced: 0 },
      { label: "d", cost: 1, unpriced: 0 },
      { label: "e", cost: 1, unpriced: 0 },
    ]);
    expect(leaderboards([call(0.5)]).projects).toEqual([
      { label: "no project", cost: 0.5, unpriced: 0 },
    ]);
  });

  test("a session is named by the project most of its calls ran in and the local day it started", () => {
    const boards = leaderboards([
      call(1, { session: "session-one", ts: "2026-06-02T08:00:00.000Z", project: "b" }),
      call(1, { session: "session-one", ts: "2026-06-01T21:30:00.000Z" }),
      call(1, { session: "session-one", ts: "2026-06-02T09:00:00.000Z", project: "a" }),
      call(1, { session: "session-one", ts: "2026-06-02T10:00:00.000Z", project: "a" }),
      call(1, { session: "session-one", ts: "2026-06-02T11:00:00.000Z" }),
      call(1, { session: "session-one", ts: "2026-06-02T12:00:00.000Z" }),
      call(0.5),
    ]);
    expect(boards.sessions).toEqual([
      { label: "session- (a, 2026-06-01)", cost: 6, unpriced: 0 },
      { label: "no session (no project, 2026-06-01)", cost: 0.5, unpriced: 0 },
    ]);
  });

  test("days are local", () => {
    const boards = leaderboards([
      call(1, { ts: "2026-06-01T21:59:00.000Z" }),
      call(2, { ts: "2026-06-01T22:00:00.000Z" }),
    ]);
    expect(boards.days).toEqual([
      { label: "2026-06-02", cost: 2, unpriced: 0 },
      { label: "2026-06-01", cost: 1, unpriced: 0 },
    ]);
  });

  test("a turn costs the calls until the next message in its session; one without calls is unknown", () => {
    const turnAt = (ts: string) => event("turn", {}, { session: "s", ts, project: "p" });
    const boards = leaderboards([
      turnAt("2026-06-01T07:00:00.000Z"),
      turnAt("2026-06-01T08:00:00.000Z"),
      call(1, { session: "s", ts: "2026-06-01T08:01:00.000Z" }),
      turnAt("2026-06-01T09:00:00.000Z"),
      call(2, { session: "s", ts: "2026-06-01T09:01:00.000Z" }),
      call(3, { session: "s", ts: "2026-06-01T09:02:00.000Z" }),
    ]);
    expect(boards.turns).toEqual([
      { label: "2026-06-01, p", cost: 5, unpriced: 0 },
      { label: "2026-06-01, p", cost: 1, unpriced: 0 },
    ]);
  });
});

describe("leaderboards as printed", () => {
  test("costs line up on the right, unpriced calls are named, an empty board is unknown", () => {
    expect(
      leaderboardLines({
        projects: [
          { label: "pal", cost: 1234.5, unpriced: 2 },
          { label: "x", cost: 1, unpriced: 0 },
        ],
        sessions: [],
        days: [],
        turns: [],
      })
    ).toEqual([
      "\n  Most expensive projects\n",
      "      $1234.50  pal + 2 unpriced calls",
      "         $1.00  x",
      "\n  Most expensive sessions\n",
      "    unknown",
      "\n  Most expensive days\n",
      "    unknown",
      "\n  Most expensive turns\n",
      "    unknown",
    ]);
  });
});

describe("pal cli cost", () => {
  test("prints the months and the leaderboards", async () => {
    appendEvent("model_call", { costUsd: 2 }, { runtime: "opencode", project: "pal" });
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runCommand(costCommand, [], ["pal", "cli", "cost"])).toBe(0);
      const text = log.mock.calls.join("\n");
      expect(text).toContain("API-equivalent $2.00");
      expect(text).toContain("       $2.00  pal");
    } finally {
      log.mockRestore();
    }
  });
});
