import { describe, expect, test } from "bun:test";
import { now } from "../src/hooks/lib/time";

describe("now", () => {
  test("returns ISO 8601 UTC string", () => {
    expect(now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
  });

  test("is a valid date", () => {
    expect(Number.isNaN(new Date(now()).getTime())).toBe(false);
  });
});
