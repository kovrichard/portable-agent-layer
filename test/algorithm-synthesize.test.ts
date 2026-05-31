import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatAlgorithmReport,
  synthesizeAlgorithm,
} from "../src/tools/agent/algorithm-synthesize";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-algo-synth");
const REFL_DIR = resolve(TEST_HOME, "memory", "learning", "reflections");
const REFL_FILE = resolve(REFL_DIR, "algorithm-reflections.jsonl");

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

beforeEach(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(REFL_DIR, { recursive: true });
});

function addReflection(
  q2: string,
  opts: { cwd?: string; sentiment?: number; ts?: string } = {}
) {
  appendFileSync(
    REFL_FILE,
    `${JSON.stringify({
      timestamp: opts.ts ?? "2026-05-30T10:00:00Z",
      cwd: opts.cwd ?? "/Users/x/code/pal",
      task: "t",
      sentiment: opts.sentiment ?? 8,
      q1: "",
      q2,
      q3: "",
    })}\n`
  );
}

describe("synthesizeAlgorithm", () => {
  test("buckets a verification-gate idea under verify-gate", () => {
    addReflection(
      "Add a premise-audit step to verify the user claim before building criteria"
    );
    const s = synthesizeAlgorithm();
    const vg = s.buckets.find((b) => b.key === "verify-gate");
    expect(vg?.count).toBe(1);
    expect(vg?.quotes[0]).toContain("premise-audit");
  });

  test("buckets a criteria idea under criteria", () => {
    addReflection("Should have included an anti-criterion for the failing path");
    const s = synthesizeAlgorithm();
    expect(s.buckets.find((b) => b.key === "criteria")?.count).toBe(1);
  });

  test("surfaces unbucketed Q2s in full text, not just a count (no silent drop)", () => {
    addReflection("xyzzy foobar plugh unrelated tokens with no algorithm area");
    const s = synthesizeAlgorithm();
    expect(s.unbucketed).toBe(1);
    expect(s.buckets.every((b) => b.count === 0)).toBe(true);
    // the safety net: the actual text is recoverable, not lost to a number
    expect(s.unbucketedQuotes).toContain(
      "xyzzy foobar plugh unrelated tokens with no algorithm area"
    );
    expect(formatAlgorithmReport(s)).toContain("xyzzy foobar plugh");
  });

  test("ranks buckets by frequency descending", () => {
    addReflection("verify the contract before acting");
    addReflection("verify the source before writing");
    addReflection("add an atomic criterion");
    const s = synthesizeAlgorithm();
    expect(s.buckets[0].key).toBe("verify-gate");
    expect(s.buckets[0].count).toBeGreaterThanOrEqual(s.buckets[1].count);
  });

  test("counts distinct projects per bucket", () => {
    addReflection("verify before acting", { cwd: "/Users/x/code/pal" });
    addReflection("reproduce before fixing", { cwd: "/Users/x/code/fyzz" });
    const s = synthesizeAlgorithm();
    expect(s.buckets.find((b) => b.key === "verify-gate")?.projects).toBe(2);
  });

  test("the since filter excludes older reflections", () => {
    addReflection("verify before acting", { ts: "2026-01-01T00:00:00Z" });
    addReflection("verify the source first", { ts: "2026-05-30T00:00:00Z" });
    const s = synthesizeAlgorithm(new Date("2026-03-01T00:00:00Z"));
    expect(s.total).toBe(1);
  });

  test("formatAlgorithmReport renders headers and the unbucketed line", () => {
    addReflection("verify before acting");
    const out = formatAlgorithmReport(synthesizeAlgorithm());
    expect(out).toContain("# Algorithm Update — Candidate Changes");
    expect(out).toContain("Unbucketed");
  });
});
