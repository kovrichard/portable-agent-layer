import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { observeTurn, recordReply, type TurnEvent } from "../src/hooks/lib/interaction";
import {
  DEFAULT_BASELINE,
  type MoodTurn,
  readMood,
} from "../src/hooks/lib/interaction-mood";
import { reload } from "../src/hooks/lib/settings";

let TEST_HOME: string;
const T0 = new Date("2026-09-10T10:00:00Z");

function at(sec: number): Date {
  return new Date(T0.getTime() + sec * 1000);
}

function eventsDir(): string {
  return resolve(TEST_HOME, "memory", "signals", "interaction");
}

function loggedEvents(): TurnEvent[] {
  return readFileSync(resolve(eventsDir(), "2026-09.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

function lastEvent(): TurnEvent {
  return loggedEvents().at(-1) as TurnEvent;
}

function setSettings(data: Record<string, unknown>) {
  writeFileSync(resolve(TEST_HOME, "memory", "pal-settings.json"), JSON.stringify(data));
  reload();
}

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

beforeEach(() => {
  TEST_HOME = mkdtempSync(resolve(tmpdir(), "pal-interaction-"));
  process.env.PAL_HOME = TEST_HOME;
  mkdirSync(resolve(TEST_HOME, "memory"), { recursive: true });
  setSettings({});
});

afterEach(() => {
  delete process.env.PAL_HOME;
  reload();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("measuring a turn", () => {
  test("logs the turn's features, never its text", () => {
    observeTurn("please rotate the staging credentials", "s1", T0, "mobile");

    const raw = readFileSync(resolve(eventsDir(), "2026-09.jsonl"), "utf-8");
    expect(raw).not.toContain("credentials");
    expect(lastEvent()).toMatchObject({ session: "s1", words: 5, channel: "mobile" });
  });

  test("the gap runs from the reply that answered the previous prompt", () => {
    observeTurn("first question here", "s1", T0);
    recordReply("s1", "an answer", at(30));
    observeTurn("next one", "s1", at(50));

    expect(lastEvent()).toMatchObject({ gapSec: 20, interrupted: false });
  });

  test("a message sent before the reply arrived is an interrupt, with no gap", () => {
    observeTurn("first", "s1", T0);
    recordReply("s1", "an earlier answer", at(10));
    observeTurn("do the thing", "s1", at(20));
    observeTurn("wait, stop", "s1", at(25));

    expect(lastEvent()).toMatchObject({ gapSec: null, interrupted: true });
  });

  test("a long reply answered faster than it can be read was skimmed", () => {
    observeTurn("explain it", "s1", T0);
    recordReply("s1", words(400), at(10));
    observeTurn("ok go", "s1", at(20));
    expect(lastEvent().skimmed).toBe(true);

    recordReply("s1", words(400), at(30));
    observeTurn("ok go", "s1", at(230));
    expect(lastEvent().skimmed).toBe(false);
  });

  test("a gap over twenty minutes is a break", () => {
    observeTurn("start", "s1", T0);
    recordReply("s1", "done", at(10));
    observeTurn("back again", "s1", at(10 + 3 * 3600));

    expect(lastEvent().afterBreak).toBe(true);
  });

  test("a correction opens with no, not with no problem", () => {
    observeTurn("no, the other file", "s1", T0);
    expect(lastEvent().corrected).toBe(true);
    observeTurn("no problem, go on", "s1", at(5));
    expect(lastEvent().corrected).toBe(false);
  });

  test("asking the same thing again is a repeat", () => {
    observeTurn("rename the billing column in the invoices table", "s1", T0);
    recordReply("s1", "done", at(10));
    observeTurn("rename the billing column in the invoices table please", "s1", at(20));

    expect(lastEvent().repeated).toBe(true);
  });

  test("injected reminders and task notifications are not turns", () => {
    expect(
      observeTurn("<task-notification>done</task-notification>", "s1", T0)
    ).toBeNull();
    observeTurn("<ide_selection>const x = 1;</ide_selection>real words", "s1", T0);

    expect(loggedEvents()).toHaveLength(1);
    expect(lastEvent().words).toBe(2);
  });

  test("records nothing when switched off", () => {
    setSettings({ dynamicContext: { interactionAwareness: false } });
    observeTurn("hello there", "s1", T0);

    expect(readdirSync(resolve(TEST_HOME, "memory")).includes("signals")).toBe(false);
  });
});

function fastShortTurn(session: string, i: number): string | null {
  recordReply(session, "short answer", at(i * 30));
  return observeTurn("yes pls", session, at(i * 30 + 10));
}

describe("telling the agent", () => {
  test("speaks when the picture changes and stays quiet while it holds", () => {
    observeTurn("start", "s1", T0);
    const reminders = [1, 2, 3, 4].map((i) => fastShortTurn("s1", i));

    expect(reminders[0]).toBeNull();
    expect(reminders[1]).toContain("short messages");
    expect(reminders[1]).not.toContain("replying fast");
    expect(reminders[2]).toContain("replying fast");
    expect(reminders[3]).toBeNull();
  });

  test("says once when the pattern is back to usual", () => {
    observeTurn("start", "s1", T0);
    for (const i of [1, 2, 3]) fastShortTurn("s1", i);
    recordReply("s1", "short answer", at(200));
    const back = observeTurn(words(40), "s1", at(200 + 3 * 3600));

    expect(back).toContain("back to their usual pattern");
  });

  test("judges against the user's own normal, not a fixed one", () => {
    mkdirSync(eventsDir(), { recursive: true });
    const terseHistory = Array.from({ length: 25 }, () =>
      JSON.stringify({ session: "old", words: 2, gapSec: 15, afterBreak: false })
    );
    writeFileSync(resolve(eventsDir(), "2026-09.jsonl"), `${terseHistory.join("\n")}\n`);

    observeTurn("start", "s1", T0);
    const reminders = [1, 2, 3, 4].map((i) => fastShortTurn("s1", i));

    expect(reminders.every((r) => r === null)).toBe(true);
  });
});

function turn(overrides: Partial<MoodTurn>): MoodTurn {
  return {
    words: 30,
    gapSec: 120,
    afterBreak: false,
    skimmed: false,
    interrupted: false,
    repeated: false,
    corrected: false,
    ...overrides,
  };
}

describe("reading the sitting", () => {
  test("time away is not slowness: only the sitting after a break counts", () => {
    const quickThenAway = [
      turn({ gapSec: 10 }),
      turn({ gapSec: 10 }),
      turn({ gapSec: 10 }),
      turn({ gapSec: 4 * 3600, afterBreak: true }),
      turn({ gapSec: 150 }),
    ];

    expect(readMood(quickThenAway, DEFAULT_BASELINE).key).toBe("");
  });

  test("two rough turns out of the last four are friction", () => {
    const rough = [
      turn({}),
      turn({ corrected: true }),
      turn({}),
      turn({ repeated: true }),
    ];

    expect(readMood(rough, DEFAULT_BASELINE).key).toBe("friction");
  });

  test("two skimmed replies out of the last three are skimming", () => {
    const skims = [turn({ skimmed: true }), turn({}), turn({ skimmed: true })];

    expect(readMood(skims, DEFAULT_BASELINE).key).toBe("skimming");
  });
});
