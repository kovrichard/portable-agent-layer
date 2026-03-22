import { describe, expect, test } from "bun:test";
import {
  buildSystemReminder,
  loadActiveWork,
  loadFailurePatterns,
  loadLearningDigest,
  loadRelationshipContext,
  loadSignalTrends,
  loadWisdomContext,
} from "../src/hooks/lib/context";
import { readFramePrinciples } from "../src/hooks/lib/wisdom";

describe("wisdom", () => {
  test("readFramePrinciples returns array", () => {
    const result = readFramePrinciples();
    expect(Array.isArray(result)).toBe(true);
  });

  test("readFramePrinciples only returns high-confidence items", () => {
    const result = readFramePrinciples();
    for (const p of result) {
      const match = p.match(/\((\d+)%\)$/);
      expect(match).toBeTruthy();
      expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(85);
    }
  });
});

describe("context builders", () => {
  test("loadWisdomContext returns string", () => {
    expect(typeof loadWisdomContext()).toBe("string");
  });

  test("loadActiveWork returns null or object", () => {
    const result = loadActiveWork();
    if (result !== null) {
      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("summary");
    }
  });

  test("loadLearningDigest returns string", () => {
    expect(typeof loadLearningDigest()).toBe("string");
  });

  test("loadFailurePatterns returns string", () => {
    expect(typeof loadFailurePatterns()).toBe("string");
  });

  test("loadSignalTrends returns string", () => {
    expect(typeof loadSignalTrends()).toBe("string");
  });

  test("loadRelationshipContext returns string", () => {
    expect(typeof loadRelationshipContext()).toBe("string");
  });

  test("buildSystemReminder returns string", () => {
    const result = buildSystemReminder();
    expect(typeof result).toBe("string");
    if (result) {
      expect(result).toContain("<system-reminder>");
      expect(result).toContain("</system-reminder>");
    }
  });
});
