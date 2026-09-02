import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildSystemReminder,
  loadLearningDigest,
  loadRelationshipContext,
  loadWisdomContext,
} from "../src/hooks/lib/context";
import { loadFailurePatterns } from "../src/hooks/lib/semi-static";
import { readFramePrinciples } from "../src/hooks/lib/wisdom";

// These are type-only smoke tests, so they need no real corpus — and reading the
// developer's own ~/.pal would let context assembly write into it (project reads
// seed bindings). A temp home keeps them deterministic and side-effect free.
let HOME: string;

beforeAll(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-context-"));
  process.env.PAL_HOME = HOME;
});

afterAll(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

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
      expect(parseInt(match?.[1] ?? "0", 10)).toBeGreaterThanOrEqual(85);
    }
  });
});

describe("context builders", () => {
  test("loadWisdomContext returns string", () => {
    expect(typeof loadWisdomContext()).toBe("string");
  });

  test("loadLearningDigest returns string", () => {
    expect(typeof loadLearningDigest()).toBe("string");
  });

  test("loadFailurePatterns returns string", () => {
    expect(typeof loadFailurePatterns()).toBe("string");
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
