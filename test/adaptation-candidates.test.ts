import { beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CandidateInput,
  readCandidates,
  recordCandidate,
  reproveWaiting,
} from "../src/hooks/lib/adaptation-candidates";
import { readRules } from "../src/hooks/lib/adaptation-rules";
import type { RequestedTurn } from "../src/hooks/lib/adaptation-turns";
import { freshTestDir } from "./lib/test-home";

let HOME: string;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
});

const candidate: CandidateInput = {
  when: "Reporting that tests pass",
  trigger: { side: "reply", pattern: "tests? pass" },
  steering: "Run the tests and quote the result before saying they pass.",
  check: "The reply quotes a test run.",
  evidence: ["claimed tests pass: they never ran"],
};

const turn = (over: Partial<RequestedTurn>): RequestedTurn => ({
  ts: "2026-10-07T08:00:00.000Z",
  session: "s1",
  message: "next please",
  replyEnd: "Renamed the key.",
  reaction: "follow-up",
  issue: "",
  prompt: "",
  ...over,
});

const corrections = [
  turn({ reaction: "corrected", confirmed: true, replyEnd: "All tests pass." }),
  turn({ reaction: "corrected", confirmed: true, replyEnd: "Tests pass now." }),
];
const ordinary = (count: number) => Array.from({ length: count }, () => turn({}));

describe("recordCandidate", () => {
  test("no file reads as no candidates", () => {
    expect(readCandidates()).toEqual([]);
  });

  test("a proven candidate becomes a draft rule carrying its proof", () => {
    const recorded = recordCandidate(candidate, [...corrections, ...ordinary(20)]);

    expect(recorded.verdict).toBe("passed");
    expect(readRules()).toMatchObject([
      {
        status: "draft",
        when: candidate.when,
        check: candidate.check,
        proof: { firedCorrections: 2, corrections: 2, firedOrdinary: 0, ordinary: 20 },
      },
    ]);
  });

  test("a failed candidate is kept with its proof and never becomes a draft", () => {
    const loud = Array.from({ length: 20 }, () => turn({ replyEnd: "tests pass" }));

    recordCandidate(candidate, [...corrections, ...loud]);

    expect(readCandidates()[0]).toMatchObject({ verdict: "failed" });
    expect(readRules()).toEqual([]);
  });

  test("a candidate without enough ordinary turns waits", () => {
    recordCandidate(candidate, [...corrections, ...ordinary(5)]);

    expect(readCandidates()[0]).toMatchObject({ verdict: "waiting" });
    expect(readRules()).toEqual([]);
  });

  test("a widening needs only the one correction its rule missed", () => {
    const widening = { ...candidate, widens: "r1" };

    recordCandidate(widening, [corrections[0], ...ordinary(20)]);

    expect(readRules()).toMatchObject([{ status: "draft", widens: "r1" }]);
  });

  test("a new rule firing on one correction still fails", () => {
    recordCandidate(candidate, [corrections[0], ...ordinary(20)]);

    expect(readCandidates()[0]).toMatchObject({ verdict: "failed" });
  });

  test("a broken line is skipped", () => {
    recordCandidate({ ...candidate, when: "first" }, corrections);
    appendFileSync(
      resolve(HOME, "memory", "adaptation", "candidates.jsonl"),
      "{ broken\n"
    );
    recordCandidate({ ...candidate, when: "second" }, corrections);

    expect(readCandidates().map((c) => c.when)).toEqual(["first", "second"]);
  });
});

describe("reproveWaiting", () => {
  test("a waiting candidate is promoted once the log has enough ordinary turns", () => {
    recordCandidate(candidate, [...corrections, ...ordinary(5)]);

    reproveWaiting([...corrections, ...ordinary(25)]);

    expect(readCandidates()[0]).toMatchObject({
      verdict: "passed",
      proof: { ordinary: 25 },
    });
    expect(readRules()).toHaveLength(1);
  });

  test("a waiting widening is proven again as a widening", () => {
    const widening = { ...candidate, widens: "r1" };
    recordCandidate(widening, [corrections[0], ...ordinary(5)]);

    reproveWaiting([corrections[0], ...ordinary(20)]);

    expect(readCandidates()[0]).toMatchObject({ verdict: "passed" });
  });

  test("a waiting candidate that still lacks turns stays waiting", () => {
    recordCandidate(candidate, [...corrections, ...ordinary(5)]);

    reproveWaiting([...corrections, ...ordinary(10)]);

    expect(readCandidates()[0]).toMatchObject({ verdict: "waiting" });
    expect(readRules()).toEqual([]);
  });

  test("a decided candidate is not proven again", () => {
    recordCandidate(candidate, [...corrections, ...ordinary(20)]);
    recordCandidate({ ...candidate, when: "waiting" }, [...corrections, ...ordinary(5)]);

    reproveWaiting([...corrections, ...ordinary(30)]);

    expect(readCandidates()[0]).toMatchObject({ proof: { ordinary: 20 } });
    expect(readRules()).toHaveLength(2);
  });
});
