import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// The line is injected on every prompt of every session, so its shape, its
// timezone handling and its kill switch are all pinned.

let TEST_HOME: string;

beforeEach(() => {
  TEST_HOME = mkdtempSync(resolve(tmpdir(), "pal-wall-clock-"));
  process.env.PAL_HOME = TEST_HOME;
  mkdirSync(resolve(TEST_HOME, "memory"), { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

async function setSettings(data: Record<string, unknown>) {
  writeFileSync(resolve(TEST_HOME, "memory", "pal-settings.json"), JSON.stringify(data));
  (await import("../src/hooks/lib/settings")).reload();
}

async function load() {
  return await import(`../src/hooks/lib/wall-clock.ts?t=${Date.now()}`);
}

const NOON_UTC = new Date("2026-09-05T12:34:56.000Z");

describe("the line", () => {
  test("names the weekday, the date, the minute and the zone", async () => {
    const { wallClockLine } = await load();

    expect(wallClockLine(NOON_UTC, "Europe/Budapest")).toBe(
      "Now: Sat 2026-09-05 14:34 Europe/Budapest"
    );
  });

  test("an unconfigured timezone reads as UTC", async () => {
    const { wallClockLine } = await load();

    expect(wallClockLine(NOON_UTC, "")).toBe("Now: Sat 2026-09-05 12:34 UTC");
  });

  test("a timezone Intl rejects falls back to UTC instead of throwing", async () => {
    const { wallClockLine } = await load();

    expect(wallClockLine(NOON_UTC, "Mars/Olympus_Mons")).toBe(
      "Now: Sat 2026-09-05 12:34 UTC"
    );
  });

  test("midnight is 00, not 24", async () => {
    const { wallClockLine } = await load();

    expect(wallClockLine(new Date("2026-09-05T00:05:00.000Z"), "")).toBe(
      "Now: Sat 2026-09-05 00:05 UTC"
    );
  });

  test("a zone across the date line reports its own day, not the UTC one", async () => {
    const { wallClockLine } = await load();

    expect(wallClockLine(new Date("2026-09-05T22:00:00.000Z"), "Asia/Tokyo")).toBe(
      "Now: Sun 2026-09-06 07:00 Asia/Tokyo"
    );
  });
});

describe("the reminder", () => {
  test("wraps the line and reads the configured timezone", async () => {
    await setSettings({ identity: { principal: { timezone: "America/New_York" } } });
    const { getWallClockReminder } = await load();

    expect(getWallClockReminder(NOON_UTC)).toBe(
      "<system-reminder>Now: Sat 2026-09-05 08:34 America/New_York</system-reminder>"
    );
  });

  test("respects the wallClock kill switch", async () => {
    await setSettings({ dynamicContext: { wallClock: false } });
    const { getWallClockReminder } = await load();

    expect(getWallClockReminder(NOON_UTC)).toBeNull();
  });

  test("stays cheap: the whole reminder fits in one short line", async () => {
    await setSettings({ identity: { principal: { timezone: "Europe/Budapest" } } });
    const { getWallClockReminder } = await load();

    const reminder = getWallClockReminder(NOON_UTC) as string;
    expect(reminder.split("\n")).toHaveLength(1);
    expect(reminder.length).toBeLessThan(100);
  });
});
