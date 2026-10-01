import { describe, expect, test } from "bun:test";
import type { TurnEvent } from "../src/hooks/lib/interaction";
import { reportLines, summarize } from "../src/tools/lib/interaction-report";

let clock = 0;

function turn(over: Partial<TurnEvent> = {}): TurnEvent {
  clock += 60;
  return {
    ts: new Date(Date.UTC(2026, 9, 1, 8, 0, clock)).toISOString(),
    session: "s1",
    channel: "terminal",
    hour: 10,
    weekday: "Thu",
    words: 5,
    gapSec: 30,
    afterBreak: false,
    skimmed: false,
    interrupted: false,
    repeated: false,
    corrected: false,
    reply: null,
    reaction: null,
    mood: "",
    hinted: false,
    ...over,
  };
}

function answered(words: number, reaction: TurnEvent["reaction"], mood = "") {
  return turn({
    reply: { words, listItems: 0, headings: 0, asked: false },
    reaction,
    mood,
  });
}

describe("interaction report", () => {
  test("a reply counts under the mood its prompt was read as", () => {
    const summary = summarize([
      turn({ mood: "short" }),
      answered(80, "approved", "short"),
      answered(90, "follow-up"),
      answered(300, "corrected"),
      answered(260, "approved"),
    ]);

    expect(summary.byLabel.short).toMatchObject({ replies: 2, medianWords: 85 });
    expect(summary.byLabel.short.approvedShare).toBe(0.5);
    expect(summary.usual).toMatchObject({ replies: 2, medianWords: 280 });
    expect(summary.usual.correctedShare).toBe(0.5);
  });

  test("a combined mood counts under each of its labels", () => {
    const summary = summarize([turn({ mood: "fast,short" }), answered(60, "follow-up")]);

    expect(summary.byLabel.fast.replies).toBe(1);
    expect(summary.byLabel.short.replies).toBe(1);
    expect(summary.usual.replies).toBe(0);
  });

  test("one session's mood never judges another session's reply", () => {
    const summary = summarize([
      turn({ session: "b" }),
      turn({ session: "a", mood: "short" }),
      { ...answered(200, "follow-up"), session: "b" },
    ]);

    expect(summary.byLabel.short.replies).toBe(0);
    expect(summary.usual.replies).toBe(1);
  });

  test("turns logged before moods were are left out of the comparison", () => {
    const old = turn({ mood: undefined });
    const summary = summarize([old, answered(200, "approved")]);

    expect(summary.unlogged).toBe(1);
    expect(summary.usual.replies).toBe(0);
  });

  test("counts the hints sent, including the return to usual", () => {
    const summary = summarize([
      turn({ mood: "short", hinted: true }),
      turn({ mood: "short" }),
      turn({ mood: "", hinted: true }),
    ]);

    expect(summary.hints).toEqual({ short: 1, "back to usual": 1 });
  });

  test("prints the comparison line against the usual replies", () => {
    const lines = reportLines(
      summarize([
        turn({ mood: "short" }),
        answered(80, "approved"),
        answered(300, "follow-up"),
      ]),
      7
    );

    expect(lines).toContain(
      "  short     1 replies · median 80 words (usual 300) · approved 100% (usual 0%) · corrected 0% (usual 0%)"
    );
    expect(lines).toContain("  long      no replies yet");
  });

  test("a repeat counts against a reply like a correction", () => {
    const summary = summarize([turn(), answered(100, "repeated")]);

    expect(summary.usual.correctedShare).toBe(1);
  });

  test("counts only the turns logged without a mood as older", () => {
    const summary = summarize([
      turn({ mood: undefined }),
      turn(),
      turn({ mood: "short" }),
    ]);

    expect(summary.unlogged).toBe(1);
  });

  test("prints turns, sessions, channels, reactions and hints", () => {
    const lines = reportLines(
      summarize([
        turn({ session: "a", channel: "mobile", mood: "short", hinted: true }),
        { ...answered(80, "approved"), session: "a", channel: "mobile" },
        { ...answered(90, "follow-up"), session: "a", channel: null },
        { ...answered(90, "follow-up"), session: "b", channel: "mobile" },
      ]),
      1
    );

    expect(lines.slice(0, 4)).toEqual([
      "Interaction report, last day",
      "Turns: 4 in 2 sessions · mobile 3 · unknown 1",
      "Reactions: follow-up 67% · approved 33%",
      "Hints sent: short 1",
    ]);
  });

  test("names the older turns left out", () => {
    const lines = reportLines(summarize([turn({ mood: undefined })]), 7);

    expect(lines.at(-1)).toBe(
      "1 older turns were logged before moods were, and are left out of the comparison."
    );
  });

  test("says so when nothing was measured", () => {
    expect(reportLines(summarize([]), 7)).toEqual([
      "No measured turns in the last 7 days.",
    ]);
  });
});
