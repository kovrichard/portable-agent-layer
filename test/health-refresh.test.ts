import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DoctorResult } from "../src/cli/doctor/agents";
import { runBackgroundDoctor } from "../src/cli/doctor/run";
import { refreshCachesOnStart } from "../src/hooks/lib/start-refresh";
import {
  healthFile,
  healthMarkerFile,
  isHealthStale,
  refreshHealthOnStart,
} from "../src/usage/health-cache";
import { debugHome } from "./lib/fake-spawn";

const HOUR_MS = 3600 * 1000;
const MINUTE_MS = 60 * 1000;
const NOW = Date.now();

let home = { home: "", log: () => "" };

beforeEach(() => {
  delete process.env.PAL_SKIP_DOCTOR;
  home = debugHome(import.meta.file);
});

function healthCheckedHoursAgo(hours: number): void {
  writeFileSync(
    healthFile(),
    JSON.stringify({
      checkedAt: new Date(NOW - hours * HOUR_MS).toISOString(),
      failing: 0,
      warnings: 0,
      worst: null,
    }),
    "utf-8"
  );
}

function markerMinutesOld(minutes: number): void {
  writeFileSync(healthMarkerFile(), "123\n", "utf-8");
  const at = new Date(Date.now() - minutes * MINUTE_MS);
  utimesSync(healthMarkerFile(), at, at);
}

function refresh(spawn: () => void = () => {}, now = NOW): number {
  let spawned = 0;
  refreshHealthOnStart(() => {
    spawned++;
    spawn();
  }, now);

  return spawned;
}

function printedDuring(run: () => void): unknown[] {
  const printed: unknown[] = [];
  const spies = [
    spyOn(console, "log").mockImplementation((...args) => printed.push(args)),
    spyOn(console, "error").mockImplementation((...args) => printed.push(args)),
    spyOn(process.stdout, "write").mockImplementation((chunk) => {
      printed.push(chunk);

      return true;
    }),
  ];

  try {
    run();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }

  return printed;
}

describe("refreshing health.json at session start", () => {
  test("a missing health.json starts one detached doctor and leaves a marker", () => {
    expect(refresh()).toBe(1);
    expect(healthMarkerFile()).toBe(resolve(home.home, "cache", "health-check.running"));
    expect(readFileSync(healthMarkerFile(), "utf-8")).toBe(`${process.pid}\n`);
  });

  test("a 7-hour-old health.json starts one", () => {
    healthCheckedHoursAgo(7);
    expect(refresh()).toBe(1);
  });

  test("a 5-hour-old health.json starts none", () => {
    healthCheckedHoursAgo(5);
    expect(refresh()).toBe(0);
    expect(existsSync(healthMarkerFile())).toBe(false);
  });

  test("goes stale at exactly 6 hours", () => {
    healthCheckedHoursAgo(6);
    expect(isHealthStale(NOW)).toBe(false);
    expect(isHealthStale(NOW + 1)).toBe(true);
  });

  test("a malformed health.json counts as missing", () => {
    writeFileSync(healthFile(), "{ nope", "utf-8");
    expect(refresh()).toBe(1);
  });

  test("a live marker starts none, so a second session does not start another", () => {
    expect(refresh()).toBe(1);
    expect(refresh()).toBe(0);
    markerMinutesOld(9);
    expect(refresh()).toBe(0);
  });

  test("a marker older than 10 minutes is ignored and taken over", () => {
    markerMinutesOld(11);
    expect(refresh()).toBe(1);
    expect(readFileSync(healthMarkerFile(), "utf-8")).toBe(`${process.pid}\n`);
  });

  test("a spawn that throws is logged, prints nothing and frees the marker", () => {
    const printed = printedDuring(() =>
      refresh(() => {
        throw new Error("no bun");
      })
    );

    expect(printed).toEqual([]);
    expect(home.log()).toContain("health-check:spawn");
    expect(home.log()).toContain("no bun");
    expect(existsSync(healthMarkerFile())).toBe(false);
  });

  test("a spawn that succeeds is logged as started", () => {
    refresh();
    expect(home.log()).toContain("detached doctor spawned");
  });

  test("PAL_SKIP_DOCTOR starts none", () => {
    process.env.PAL_SKIP_DOCTOR = "1";
    expect(refresh()).toBe(0);
    process.env.PAL_SKIP_DOCTOR = "0";
    expect(refresh()).toBe(1);
  });

  test("measures against the current time when given none", () => {
    let spawned = 0;
    healthCheckedHoursAgo(5);
    refreshHealthOnStart(() => spawned++);
    expect(spawned).toBe(0);
    healthCheckedHoursAgo(7);
    refreshHealthOnStart(() => spawned++);
    expect(spawned).toBe(1);
  });
});

describe("the background doctor", () => {
  const health = { hasAgent: false } as DoctorResult;

  test("builds a report from a fresh detection, then frees the marker", () => {
    markerMinutesOld(0);
    const reported: DoctorResult[] = [];
    runBackgroundDoctor(
      (detected) => reported.push(detected),
      () => health
    );

    expect(reported).toEqual([health]);
    expect(existsSync(healthMarkerFile())).toBe(false);
  });

  test("frees the marker when the report throws", () => {
    markerMinutesOld(0);

    expect(() =>
      runBackgroundDoctor(
        () => {
          throw new Error("boom");
        },
        () => health
      )
    ).toThrow("boom");
    expect(existsSync(healthMarkerFile())).toBe(false);
  });
});

describe("the session-start refresh", () => {
  test("refreshes the login first, then health", () => {
    const order: string[] = [];
    refreshCachesOnStart(
      () => order.push("login"),
      () => order.push("health")
    );

    expect(order).toEqual(["login", "health"]);
  });

  test("is what LoadContext calls", () => {
    const loadContext = readFileSync(
      resolve(import.meta.dir, "..", "src", "hooks", "LoadContext.ts"),
      "utf-8"
    );

    expect(loadContext).toContain("\nrefreshCachesOnStart();\n");
    expect(loadContext).not.toContain("refreshLoginOnStart");
  });
});
