import { describe, expect, test } from "bun:test";
import { sessionNodeTitle } from "../src/hooks/lib/progress-tree-session-node";

const now = new Date("2026-10-19T12:51:30Z");

describe("session node title", () => {
  test("is the session's name when it has one", () => {
    expect(sessionNodeTitle("s1", now, { s1: "Canary Releases" })).toBe(
      "Canary Releases"
    );
  });

  test("falls back to when the session started recording", () => {
    expect(sessionNodeTitle("s2", now, { s1: "Canary Releases" })).toBe(
      "Session 2026-10-19 12:51"
    );
    expect(sessionNodeTitle(undefined, now, {})).toBe("Session 2026-10-19 12:51");
  });
});
