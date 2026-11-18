import { describe, expect, test } from "bun:test";
import {
  LENSES,
  lensFor,
  minimumStopReason,
  nextLensName,
  ROUND_COMMAND,
} from "../src/safety/minimum-prompt";
import { newRun, type Run } from "../src/safety/run-mode";

const NOW = new Date("2026-10-31T16:00:00Z");
const BEFORE = new Date("2026-10-31T16:10:00Z");
const AFTER = new Date("2026-10-31T16:40:00Z");
const UNTIL = new Date("2026-10-31T16:30:00Z");
const ROUND = {
  at: NOW.toISOString(),
  scores: "clarity: 7/10, accuracy: 8/10",
  weakest: "the intro buries the answer",
  did: "rewrote section two",
};

function minimum(extra: Partial<Run> = {}): Run {
  return {
    ...newRun({
      kind: "minimum",
      scope: "s",
      until: UNTIL,
      now: NOW,
      goal: "a one-page brief the board can act on",
      bar: ["clarity: 9/10, reread against the brief", "accuracy: every number sourced"],
    }),
    ...extra,
  };
}

describe("the push-back before the floor", () => {
  test("carries the minutes left, the goal, the bar and the last weakest point", () => {
    const reason = minimumStopReason(minimum({ rounds: [ROUND] }), BEFORE) ?? "";

    for (const part of [
      "20 min left",
      "a one-page brief the board can act on",
      "clarity: 9/10, reread against the brief",
      "accuracy: every number sourced",
      "clarity: 7/10, accuracy: 8/10",
      "the intro buries the answer",
    ])
      expect(reason).toContain(part);
  });

  test("says when no round was logged yet", () => {
    expect(minimumStopReason(minimum(), BEFORE)).toContain("no round logged yet");
  });

  test("ends with the exact round command and that only the user ends early", () => {
    const lines = (minimumStopReason(minimum(), BEFORE) ?? "").split("\n");
    expect(lines.at(-2)).toContain(ROUND_COMMAND);
    expect(lines.at(-1)).toContain("Only the user ends a minimum run early");
  });

  test("rotates the lens on the block count", () => {
    LENSES.forEach((lens, blocks) => {
      const run = minimum({ stopBlocks: blocks, rounds: [ROUND], roundsAtLastBlock: 0 });
      expect(minimumStopReason(run, BEFORE)).toContain(
        `lens "${lens.name}": ${lens.text}`
      );
      expect(nextLensName(run)).toBe(lens.name);
    });
    expect(lensFor(LENSES.length).name).toBe(LENSES[0]?.name as string);
  });

  test("the lenses include a fresh-context critic, which needs a subagent", () => {
    expect(LENSES.map((l) => l.name)).toContain("critic");
    expect(LENSES.find((l) => l.name === "critic")?.text).toContain("subagent");
  });

  test("demands a round when none was logged since the last push-back", () => {
    const run = minimum({ stopBlocks: 2, rounds: [ROUND], roundsAtLastBlock: 1 });
    const reason = minimumStopReason(run, BEFORE) ?? "";
    expect(reason).toContain("You stopped without logging a round");
    expect(reason).toContain(ROUND_COMMAND);
    expect(reason).not.toContain("lens");
    expect(nextLensName(run)).toBeNull();
  });

  test("tells an agent whose reply asked the user to pick the default itself", () => {
    expect(minimumStopReason(minimum(), BEFORE, true)).toContain(
      "Questions belong in the intake"
    );
    expect(minimumStopReason(minimum(), BEFORE, false)).not.toContain("intake");
  });
});

describe("after the floor", () => {
  test("there is no push-back", () => {
    expect(minimumStopReason(minimum(), AFTER)).toBeNull();
    expect(minimumStopReason(minimum(), UNTIL)).toBeNull();
  });
});
