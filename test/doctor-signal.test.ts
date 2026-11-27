import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eventsSince } from "../src/bronze/events";
import {
  type DoctorRun,
  persistentFailures,
  recordDoctorRun,
} from "../src/report/doctor-signal";
import { freshTestDir } from "./lib/test-home";

const HOUR = 60 * 60 * 1000;
const START = Date.parse("2026-11-20T00:00:00Z");

const at = (hours: number) => new Date(START + hours * HOUR).toISOString();
const run = (hours: number, ...failing: string[]): DoctorRun => ({
  ts: at(hours),
  failing,
});

beforeEach(() => {
  process.env.PAL_HOME = resolve(freshTestDir(import.meta.file), "home");
});

describe("persistentFailures", () => {
  test("a check failing on three runs over twelve hours completes a streak", () => {
    expect(
      persistentFailures([run(0, "a", "b"), run(6, "a"), run(12, "a", "c")])
    ).toEqual(["a"]);
  });

  test("three runs closer together than twelve hours are not a streak", () => {
    expect(persistentFailures([run(0, "a"), run(6, "a"), run(11, "a")])).toEqual([]);
  });

  test("fewer than three runs are not a streak", () => {
    expect(persistentFailures([run(0, "a"), run(24, "a")])).toEqual([]);
  });

  test("a streak is reported once, not again on every later run", () => {
    expect(
      persistentFailures([run(0, "a"), run(6, "a"), run(12, "a"), run(18, "a")])
    ).toEqual([]);
  });

  test("a check that passed once in the streak is not reported", () => {
    expect(persistentFailures([run(0, "a"), run(6), run(12, "a")])).toEqual([]);
  });
});

describe("recordDoctorRun", () => {
  const findings = (...failing: string[]) => [
    ...failing.map((id) => ({ id, severity: "fail" })),
    { id: "rtk", severity: "warn" },
    { id: "agents", severity: "ok" },
  ];

  test("logs each run's failing and warning checks", () => {
    recordDoctorRun(findings("claude-login"), new Date(at(0)));

    expect(eventsSince("doctor_run", new Date(0))).toEqual([
      expect.objectContaining({
        ts: at(0),
        failing: ["claude-login"],
        warnings: ["rtk"],
      }),
    ]);
  });

  test("the run that completes a streak logs one shadow signal", () => {
    for (const hours of [0, 6, 12, 18])
      recordDoctorRun(findings("claude-login"), new Date(at(hours)));

    expect(
      eventsSince("pal_bug_signal", new Date(0)).map((e) => [e.trigger, e.surface])
    ).toEqual([["doctor-stays-failed", "claude-login"]]);
  });
});
