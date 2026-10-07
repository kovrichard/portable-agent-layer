import { describe, expect, test } from "bun:test";
import type { RequestedTurn } from "../src/hooks/lib/adaptation-turns";
import { proofVerdict, proveTrigger } from "../src/hooks/lib/rule-proof";

const turn = (over: Partial<RequestedTurn>): RequestedTurn => ({
  ts: "2026-10-07T08:00:00.000Z",
  session: "s1",
  message: "next please",
  replyEnd: "Renamed the key.",
  reaction: "follow-up",
  issue: "",
  prompt: "rename the key",
  ...over,
});

const correction = (over: Partial<RequestedTurn>) =>
  turn({ reaction: "corrected", confirmed: true, ...over });

const ordinary = (count: number, over: Partial<RequestedTurn> = {}) =>
  Array.from({ length: count }, () => turn(over));

const replyTrigger = { side: "reply" as const, pattern: "tests? pass" };

describe("proveTrigger", () => {
  test("counts where a reply trigger fires among corrections and ordinary turns", () => {
    const turns = [
      correction({ replyEnd: "All tests pass." }),
      correction({ replyEnd: "The TESTS PASS now." }),
      correction({ replyEnd: "Wrong path, sorry." }),
      turn({ replyEnd: "Tests pass on main." }),
      ...ordinary(3),
    ];

    expect(proveTrigger(replyTrigger, turns)).toEqual({
      firedCorrections: 2,
      corrections: 3,
      firedOrdinary: 1,
      ordinary: 4,
    });
  });

  test("a prompt trigger reads the request, and turns without one are not counted", () => {
    const trigger = { side: "prompt" as const, pattern: "delete" };
    const turns = [
      correction({ prompt: "delete the old logs" }),
      correction({ prompt: "" }),
      turn({ prompt: "delete the branch" }),
      turn({ prompt: "" }),
      turn({ prompt: "rename it" }),
    ];

    expect(proveTrigger(trigger, turns)).toEqual({
      firedCorrections: 1,
      corrections: 1,
      firedOrdinary: 1,
      ordinary: 2,
    });
  });

  test("unconfirmed corrections and repeats count as neither", () => {
    const turns = [
      correction({ replyEnd: "tests pass", confirmed: false }),
      turn({ reaction: "repeated", replyEnd: "tests pass" }),
    ];

    expect(proveTrigger(replyTrigger, turns)).toEqual({
      firedCorrections: 0,
      corrections: 0,
      firedOrdinary: 0,
      ordinary: 0,
    });
  });

  test("a confirmed repeat counts as a correction", () => {
    const turns = [
      turn({ reaction: "repeated", confirmed: true, replyEnd: "tests pass" }),
    ];

    expect(proveTrigger(replyTrigger, turns).firedCorrections).toBe(1);
  });
});

describe("proofVerdict", () => {
  const proof = { firedCorrections: 2, corrections: 3, firedOrdinary: 2, ordinary: 20 };

  test("fires on two corrections and on at most a tenth of ordinary turns: passed", () => {
    expect(proofVerdict(proof)).toBe("passed");
  });

  test("fires on fewer than two corrections: failed", () => {
    expect(proofVerdict({ ...proof, firedCorrections: 1 })).toBe("failed");
  });

  test("fires on more than a tenth of ordinary turns: failed", () => {
    expect(proofVerdict({ ...proof, firedOrdinary: 3 })).toBe("failed");
  });

  test("too few ordinary turns to show it stays quiet: waiting", () => {
    expect(proofVerdict({ ...proof, ordinary: 19, firedOrdinary: 0 })).toBe("waiting");
  });

  test("too few corrections fired fails even before enough ordinary turns", () => {
    expect(proofVerdict({ ...proof, firedCorrections: 1, ordinary: 5 })).toBe("failed");
  });
});
