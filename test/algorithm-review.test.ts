import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  algorithmReviewNudge,
  countUnreviewed,
  isMaintainerEnv,
  loadAlgorithmReviewNudge,
  readReviewMark,
  writeReviewMark,
} from "../src/hooks/lib/algorithm-review";

const REPO_ROOT = resolve(import.meta.dir, "..");
const TEST_HOME = resolve(import.meta.dir, "../.test-home-algo-review");
const REFL_FILE = resolve(
  TEST_HOME,
  "memory",
  "learning",
  "reflections",
  "algorithm-reflections.jsonl"
);
const NOW = new Date("2026-06-01T00:00:00Z");

function addReflections(n: number, ts: string) {
  mkdirSync(resolve(TEST_HOME, "memory", "learning", "reflections"), { recursive: true });
  for (let i = 0; i < n; i++) {
    appendFileSync(
      REFL_FILE,
      `${JSON.stringify({ timestamp: ts, cwd: "/x", task: "t", sentiment: 8, q1: "", q2: `idea ${i}`, q3: "" })}\n`
    );
  }
}

/** Maintainer env: PAL_PKG points at the real repo, where the skill exists. */
function asMaintainer() {
  process.env.PAL_PKG = REPO_ROOT;
}
/** Downstream env: PAL_PKG points at a dir with no .agents/ skill. */
function asDownstream() {
  process.env.PAL_PKG = TEST_HOME;
}

beforeEach(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PAL_HOME = TEST_HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  delete process.env.PAL_PKG;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

describe("maintainer gate", () => {
  test("isMaintainerEnv true when the repo-only skill is present", () => {
    asMaintainer();
    expect(isMaintainerEnv()).toBe(true);
  });

  test("isMaintainerEnv false for a downstream install (no .agents/ skill)", () => {
    asDownstream();
    expect(isMaintainerEnv()).toBe(false);
  });
});

describe("review mark", () => {
  test("write/read roundtrip", () => {
    writeReviewMark("2026-05-01T00:00:00Z");
    expect(readReviewMark()).toBe("2026-05-01T00:00:00Z");
  });

  test("readReviewMark is null when unset", () => {
    expect(readReviewMark()).toBeNull();
  });
});

describe("countUnreviewed", () => {
  test("counts all reflections when never reviewed", () => {
    addReflections(5, "2026-05-30T00:00:00Z");
    expect(countUnreviewed(null)).toBe(5);
  });

  test("counts only reflections newer than the mark", () => {
    addReflections(3, "2026-04-01T00:00:00Z");
    addReflections(4, "2026-05-30T00:00:00Z");
    expect(countUnreviewed("2026-05-01T00:00:00Z")).toBe(4);
  });
});

describe("algorithmReviewNudge — AND-gated thresholds", () => {
  test("null for downstream even with a huge backlog", () => {
    asDownstream();
    addReflections(100, "2026-05-30T00:00:00Z");
    expect(algorithmReviewNudge(NOW)).toBeNull();
  });

  test("null when fewer than 25 new reflections", () => {
    asMaintainer();
    addReflections(24, "2026-05-30T00:00:00Z");
    writeReviewMark("2026-01-01T00:00:00Z"); // 5 months ago → time gate passes
    expect(algorithmReviewNudge(NOW)).toBeNull();
  });

  test("null when 25+ new but within 7 days of last review", () => {
    asMaintainer();
    addReflections(30, "2026-05-30T00:00:00Z");
    writeReviewMark("2026-05-29T00:00:00Z"); // 3 days before NOW
    expect(algorithmReviewNudge(NOW)).toBeNull();
  });

  test("fires when BOTH thresholds are met", () => {
    asMaintainer();
    addReflections(30, "2026-05-30T00:00:00Z");
    writeReviewMark("2026-05-01T00:00:00Z"); // 31 days before NOW
    const n = algorithmReviewNudge(NOW);
    expect(n).not.toBeNull();
    expect(n?.count).toBe(30);
    expect(n?.sinceDays).toBeGreaterThanOrEqual(7);
  });

  test("loadAlgorithmReviewNudge renders the nudge text when firing, else empty", () => {
    asMaintainer();
    addReflections(30, "2026-05-30T00:00:00Z");
    writeReviewMark("2026-05-01T00:00:00Z");
    expect(loadAlgorithmReviewNudge(NOW)).toContain("/algorithm-update");

    writeReviewMark("2026-05-30T12:00:00Z"); // now within 7 days → suppressed
    expect(loadAlgorithmReviewNudge(NOW)).toBe("");
  });
});
