import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Finding, Severity } from "../src/cli/doctor/finding";
import {
  findingLabel,
  healthSummary,
  saveHealthSummary,
} from "../src/cli/doctor/summary";
import { healthFile, writeHealthSummary } from "../src/hooks/lib/health-cache";
import { debugHome } from "./lib/fake-spawn";

const NOW = new Date("2026-11-15T11:00:00.000Z");

let home = { home: "", log: () => "" };

beforeEach(() => {
  home = debugHome(import.meta.file);
});

const finding = (severity: Severity, title = `a ${severity} finding`): Finding => ({
  id: title,
  severity,
  title,
});

describe("the health summary", () => {
  test("counts failures and warnings, and ignores optional and passing findings", () => {
    const findings = [
      finding("ok"),
      finding("warn", "first warning"),
      finding("optional"),
      finding("fail", "first failure"),
      finding("warn", "second warning"),
      finding("fail", "second failure"),
      finding("warn", "third warning"),
    ];

    expect(healthSummary(findings, NOW)).toEqual({
      checkedAt: "2026-11-15T11:00:00.000Z",
      failing: 2,
      warnings: 3,
      worst: "first failure",
    });
  });

  test("names no worst finding when nothing fails", () => {
    expect(healthSummary([finding("warn"), finding("ok")], NOW)).toEqual({
      checkedAt: "2026-11-15T11:00:00.000Z",
      failing: 0,
      warnings: 1,
      worst: null,
    });
  });

  test("stamps the current time when given none", () => {
    const before = Date.now();
    const stamped = Date.parse(healthSummary([]).checkedAt);

    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  test("the worst finding's label is its title up to the first dash, at most 60 characters", () => {
    const rejected = finding(
      "fail",
      "Background calls to Claude could not log in — 38 failed in the last 24h — again"
    );

    expect(healthSummary([rejected], NOW).worst).toBe(
      "Background calls to Claude could not log in"
    );
    expect(findingLabel("x".repeat(61))).toBe("x".repeat(60));
    expect(findingLabel("x".repeat(60))).toBe("x".repeat(60));
    expect(findingLabel("a-b – c—d")).toBe("a-b – c—d");
  });
});

describe("saving the health summary", () => {
  test("writes the summary to cache/health.json and leaves no partial file", () => {
    saveHealthSummary([finding("fail", "Broken — fix it"), finding("warn")]);
    const saved = JSON.parse(readFileSync(healthFile(), "utf-8"));

    expect(healthFile()).toBe(resolve(home.home, "cache", "health.json"));
    expect(readdirSync(resolve(home.home, "cache"))).toEqual(["health.json"]);
    expect(saved).toMatchObject({ failing: 1, warnings: 1, worst: "Broken" });
    expect(typeof saved.checkedAt).toBe("string");
    expect(readFileSync(healthFile(), "utf-8")).toEndWith("}\n");
  });

  test("a write that throws is logged and swallowed", () => {
    const written: unknown[] = [];

    expect(() =>
      saveHealthSummary([finding("warn")], (summary) => {
        written.push(summary);
        throw new Error("disk full");
      })
    ).not.toThrow();
    expect(written).toHaveLength(1);
    expect(home.log()).toContain("doctor:health-summary");
    expect(home.log()).toContain("disk full");
  });

  test("the write replaces an older summary in one rename", () => {
    writeHealthSummary({ checkedAt: "old", failing: 5, warnings: 0, worst: "old" });
    writeHealthSummary({ checkedAt: "new", failing: 0, warnings: 0, worst: null });

    expect(JSON.parse(readFileSync(healthFile(), "utf-8"))).toEqual({
      checkedAt: "new",
      failing: 0,
      warnings: 0,
      worst: null,
    });
  });
});
