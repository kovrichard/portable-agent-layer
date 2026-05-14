import { describe, expect, test } from "bun:test";
import { fileTimestamp, monthPath, now } from "../src/hooks/lib/time";

describe("now", () => {
  test("returns ISO 8601 UTC string", () => {
    expect(now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
  });

  test("is a valid date", () => {
    expect(Number.isNaN(new Date(now()).getTime())).toBe(false);
  });
});

describe("monthPath", () => {
  test("returns YYYY/MM format", () => {
    expect(monthPath()).toMatch(/^\d{4}\/\d{2}$/);
  });

  test("month is zero-padded", () => {
    const [, mm] = monthPath().split("/");
    expect(mm).toHaveLength(2);
  });
});

describe("fileTimestamp", () => {
  test("returns YYYYMMDD-HHmmss format", () => {
    expect(fileTimestamp()).toMatch(/^\d{8}-\d{6}$/);
  });

  test("contains no colons or hyphens in date part", () => {
    const ts = fileTimestamp();
    expect(ts.slice(0, 8)).not.toContain("-");
    expect(ts.slice(0, 8)).not.toContain(":");
  });
});
