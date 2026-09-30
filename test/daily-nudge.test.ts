import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { oncePerDay } from "../src/hooks/lib/daily-nudge";
import { reload } from "../src/hooks/lib/settings";

let HOME: string;
const savedHome = process.env.PAL_HOME;

function setTimezone(timezone: string): void {
  writeFileSync(
    resolve(HOME, "memory", "pal-settings.json"),
    JSON.stringify({ identity: { principal: { timezone } } })
  );
  reload();
}

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-daily-nudge-"));
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
  process.env.PAL_HOME = HOME;
  reload();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  rmSync(HOME, { recursive: true, force: true });
  reload();
});

describe("a reminder shown once a day", () => {
  const morning = new Date("2026-09-30T08:00:00Z");
  const evening = new Date("2026-09-30T18:00:00Z");
  const nextMorning = new Date("2026-10-01T08:00:00Z");

  test("appears in the first session of the day", () => {
    expect(oncePerDay("analyze", "## Due", morning)).toBe("## Due");
  });

  test("stays out of every later session that day", () => {
    oncePerDay("analyze", "## Due", morning);
    expect(oncePerDay("analyze", "## Due", evening)).toBe("");
  });

  test("comes back the next day", () => {
    oncePerDay("analyze", "## Due", morning);
    expect(oncePerDay("analyze", "## Due", nextMorning)).toBe("## Due");
  });

  test("is counted separately for each reminder", () => {
    oncePerDay("analyze", "## Analyze due", morning);
    expect(oncePerDay("reflect", "## Reflect due", evening)).toBe("## Reflect due");
  });

  test("a day that had nothing to remind does not use up the slot", () => {
    oncePerDay("analyze", "", morning);
    expect(oncePerDay("analyze", "## Due", evening)).toBe("## Due");
  });

  test("the day turns over at the user's midnight, not UTC's", () => {
    setTimezone("Europe/Budapest");
    oncePerDay("analyze", "## Due", new Date("2026-09-30T20:00:00Z"));
    expect(oncePerDay("analyze", "## Due", new Date("2026-09-30T22:30:00Z"))).toBe(
      "## Due"
    );
  });

  test("an unreadable record shows the reminder rather than hiding it", () => {
    writeFileSync(resolve(HOME, "memory", "state", "nudges-shown.json"), "{ not json");
    expect(oncePerDay("analyze", "## Due", morning)).toBe("## Due");
  });
});
