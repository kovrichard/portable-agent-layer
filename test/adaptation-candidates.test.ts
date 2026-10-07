import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  appendCandidate,
  type CandidateInput,
  readCandidates,
} from "../src/hooks/lib/adaptation-candidates";

let HOME: string;
const savedHome = process.env.PAL_HOME;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-candidates-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  rmSync(HOME, { recursive: true, force: true });
});

const candidate: CandidateInput = {
  when: "Reporting that tests pass",
  trigger: { side: "reply", pattern: "tests? pass" },
  steering: "Run the tests and quote the result before saying they pass.",
  check: "The reply quotes a test run.",
  evidence: ["claimed tests pass: they never ran"],
};

describe("candidates", () => {
  test("no file reads as no candidates", () => {
    expect(readCandidates()).toEqual([]);
  });

  test("a candidate reads back with its creation time", () => {
    appendCandidate(candidate, new Date("2026-10-07T08:00:00Z"));

    expect(readCandidates()).toEqual([
      { ...candidate, createdAt: "2026-10-07T08:00:00.000Z" },
    ]);
  });

  test("candidates keep their order and a broken line is skipped", () => {
    appendCandidate({ ...candidate, when: "first" });
    appendFileSync(
      resolve(HOME, "memory", "adaptation", "candidates.jsonl"),
      "{ broken\n"
    );
    appendCandidate({ ...candidate, when: "second" });

    expect(readCandidates().map((c) => c.when)).toEqual(["first", "second"]);
  });
});
