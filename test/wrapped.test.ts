import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { wrappedCommand } from "../src/cli/wrapped";
import { appendEvent, type EventType, type LoggedEvent } from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import { runCommand } from "../src/tools/lib/command";
import { totalsLines } from "../src/tools/lib/wrapped/render";
import { type WrappedTotals, wrappedTotals } from "../src/tools/lib/wrapped/totals";
import { eventsOfYear } from "../src/tools/lib/wrapped/year";
import { freshTestDir } from "./lib/test-home";

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify({ identity: { principal: { timezone: "Europe/Budapest" } } })
  );
  reload();
});

let seq = 0;

function event(
  type: EventType,
  fields: Record<string, unknown> = {},
  envelope: Partial<LoggedEvent> = {}
): LoggedEvent {
  seq++;
  return {
    v: 1,
    id: `e${seq}`,
    ts: "2026-06-01T10:00:00.000Z",
    type,
    session: null,
    runtime: "claude",
    machine: "m",
    actor: "a",
    authority: "self",
    channel: null,
    project: null,
    cwd: "/w",
    ...envelope,
    ...fields,
  };
}

describe("the year's events", () => {
  test("a year starts and ends at midnight in the principal's timezone", () => {
    appendEvent(
      "commit",
      {},
      { ts: "2025-12-31T23:30:00.000Z", id: "new-year-in-budapest" }
    );
    appendEvent("commit", {}, { ts: "2025-12-31T22:30:00.000Z", id: "still-last-year" });
    appendEvent(
      "commit",
      {},
      { ts: "2026-12-31T23:30:00.000Z", id: "already-next-year" }
    );
    appendEvent("commit", {}, { ts: "2026-12-31T22:30:00.000Z", id: "last-hour" });

    expect(eventsOfYear(2026).map((e) => e.id)).toEqual([
      "new-year-in-budapest",
      "last-hour",
    ]);
  });
});

describe("totals", () => {
  test("projects and commits are counted, events without a project are not one", () => {
    const totals = wrappedTotals([
      event("commit", {}, { project: "a" }),
      event("commit", {}, { project: "b" }),
      event("turn", {}, { project: "a" }),
      event("turn"),
    ]);
    expect(totals.projects).toBe(2);
    expect(totals.commits).toBe(2);
  });

  describe("sessions", () => {
    const spawned = { entrypoint: "sdk-cli" };
    const sessions = (...events: LoggedEvent[]) => wrappedTotals(events).sessions;

    test("one PAL spawned for its own inference is not the user's, even when it ends", () => {
      expect(
        sessions(
          event("model_call", spawned, { session: "pal-haiku" }),
          event("session_end", {}, { session: "pal-haiku" })
        )
      ).toBe(0);
    });

    test("an SDK session the user typed into is theirs", () => {
      expect(
        sessions(
          event("model_call", spawned, { session: "discord" }),
          event("turn", {}, { session: "discord" })
        )
      ).toBe(1);
    });

    test("a terminal session that also spawned is the user's", () => {
      expect(
        sessions(
          event("model_call", { entrypoint: "cli" }, { session: "terminal" }),
          event("model_call", spawned, { session: "terminal" })
        )
      ).toBe(1);
    });

    test("only a model call marks a spawn", () => {
      expect(sessions(event("session_start", spawned, { session: "started" }))).toBe(1);
    });

    test("events outside any session are not one", () => {
      expect(sessions(event("commit"))).toBe(0);
    });
  });

  test("tokens add every counted field; a call with no counts is reported, not zero", () => {
    const totals = wrappedTotals([
      event("model_call", {
        inputTokens: 10,
        outputTokens: 5,
        cacheWrite5m: 100,
        cacheWrite1h: 1000,
        cacheRead: 10000,
        thinkingTokens: 3,
      }),
      event("model_call", { outputTokens: 7 }),
      event("model_call"),
    ]);
    expect(totals.tokens).toBe(11122);
    expect(totals.callsWithoutTokens).toBe(1);
  });

  test("API-equivalent and paid come from the cost report's pricing", () => {
    const totals = wrappedTotals([
      event("model_call", { costUsd: 0.25, billing: "api" }, { runtime: "opencode" }),
      event(
        "model_call",
        { costUsd: 0.5, billing: "api" },
        { runtime: "opencode", ts: "2026-07-01T10:00:00.000Z" }
      ),
      event("model_call", {}, { runtime: "copilot", billing: "api" }),
    ]);
    expect(totals.cost).toEqual({ apiEquivalent: 0.75, unpriced: 1, paid: 0.75 });
  });

  test("paid stays unknown when one agent's billing is", () => {
    const totals = wrappedTotals([
      event("model_call", { costUsd: 0.25, billing: "api" }, { runtime: "opencode" }),
      event("model_call", {}, { runtime: "copilot" }),
    ]);
    expect(totals.cost.paid).toBeNull();
  });
});

describe("the totals as printed", () => {
  const totals = (overrides: Partial<WrappedTotals>): WrappedTotals => ({
    projects: 1200,
    sessions: 3,
    commits: 4,
    tokens: 1234567,
    callsWithoutTokens: 0,
    cost: { apiEquivalent: 12.5, unpriced: 0, paid: 100 },
    ...overrides,
  });

  test("every count is labelled and known amounts print plainly", () => {
    expect(totalsLines(totals({}))).toEqual([
      "\n  Totals\n",
      "    projects             1,200",
      "    sessions             3",
      "    commits              4",
      "    tokens               1,234,567",
      "    API-equivalent       $12.50",
      "    paid                 $100.00",
    ]);
  });

  test("what is not known is said, not printed as zero", () => {
    const lines = totalsLines(
      totals({
        callsWithoutTokens: 2,
        cost: { apiEquivalent: 12.5, unpriced: 3, paid: null },
      })
    );
    expect(lines.slice(4)).toEqual([
      "    tokens               1,234,567 + 2 calls without counts",
      "    API-equivalent       $12.50 + 3 unpriced calls",
      "    paid                 unknown",
    ]);
  });
});

async function wrapped(
  ...args: string[]
): Promise<{ code: number; text: string; errors: string }> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  const joined = (calls: unknown[][]) => calls.map((c) => c.join(" ")).join("\n");
  try {
    const code = await runCommand(wrappedCommand, args, ["pal", "cli", "wrapped"]);
    return { code, text: joined(log.mock.calls), errors: joined(error.mock.calls) };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("pal cli wrapped", () => {
  test("prints the asked year's totals", async () => {
    appendEvent("commit", {}, { ts: "2025-05-01T10:00:00.000Z" });
    appendEvent("commit", {}, { ts: "2025-05-02T10:00:00.000Z" });
    appendEvent("commit", {}, { ts: "2026-05-01T10:00:00.000Z" });

    const { code, text } = await wrapped("--year", "2025");
    expect(code).toBe(0);
    expect(text).toContain("PAL Wrapped 2025");
    expect(text).toMatch(/commits +2\n/);
  });

  test("a year with nothing logged says so", async () => {
    const { code, text } = await wrapped("--year", "2019");
    expect(code).toBe(0);
    expect(text).toContain("No events logged in 2019");
  });

  test("without --year it is this year", async () => {
    const { text } = await wrapped();
    expect(text).toContain(`PAL Wrapped ${new Date().getFullYear()}`);
  });

  test.each([
    "26",
    "2026x",
    "x2026",
  ])("--year %s is refused and says why", async (year) => {
    const { code, errors } = await wrapped("--year", year);
    expect(code).not.toBe(0);
    expect(errors).toContain(`--year takes a year, got: ${year}`);
  });
});
