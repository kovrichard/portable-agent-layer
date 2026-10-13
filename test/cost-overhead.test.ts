import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { costCommand } from "../src/cli/cost";
import { appendEvent } from "../src/hooks/lib/events";
import { runCommand } from "../src/tools/lib/command";
import { contextOverhead } from "../src/tools/lib/cost/overhead";
import { overheadLines } from "../src/tools/lib/cost/render";
import { budapestHome, event } from "./lib/wrapped-events";

beforeEach(() => {
  budapestHome(import.meta.file);
});

const injected = (
  session: string | null,
  ts: string,
  [instructionsChars, semiStaticChars, dynamicChars]: unknown[]
) =>
  event(
    "context_injected",
    { instructionsChars, semiStaticChars, dynamicChars },
    { session, ts }
  );

describe("context overhead", () => {
  test("unknown before anything was logged", () => {
    expect(contextOverhead([event("turn")])).toBeNull();
  });

  test("a session's injections add up; sessionless ones stand alone", () => {
    expect(
      contextOverhead([
        injected("s", "2026-06-02T10:00:00.000Z", [100, 40, 10]),
        injected("s", "2026-06-02T12:00:00.000Z", [100, 40, 20]),
        injected("s", "2026-06-02T13:00:00.000Z", [0, 0, 0]),
        injected(null, "2026-06-01T21:59:00.000Z", [100, 40, 30]),
        injected(null, "2026-06-02T09:00:00.000Z", [100, undefined, 60]),
      ])
    ).toEqual({
      since: "2026-06-01",
      sessions: 3,
      perSession: { instructionsChars: 400 / 3, semiStaticChars: 40, dynamicChars: 40 },
    });
  });
});

describe("context overhead as printed", () => {
  test("each tier and their total, rounded to whole chars", () => {
    expect(
      overheadLines({
        since: "2026-06-01",
        sessions: 1,
        perSession: {
          instructionsChars: 4567.4,
          semiStaticChars: 120,
          dynamicChars: 2.6,
        },
      })
    ).toEqual([
      "\n  PAL context per session, over 1 session since 2026-06-01\n",
      "    Instructions    4,567 chars",
      "    Semi-static       120 chars",
      "    Dynamic             3 chars",
      "    Total           4,690 chars",
    ]);
    expect(overheadLines(null)).toEqual(["\n  PAL context per session\n", "    unknown"]);
  });
});

describe("pal cli cost", () => {
  test("prints the context overhead", async () => {
    appendEvent(
      "context_injected",
      { instructionsChars: 10, semiStaticChars: 20, dynamicChars: 30 },
      { session: "s" }
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runCommand(costCommand, [], ["pal", "cli", "cost"])).toBe(0);
      expect(log.mock.calls.join("\n")).toContain("    Total              60 chars");
    } finally {
      log.mockRestore();
    }
  });
});
