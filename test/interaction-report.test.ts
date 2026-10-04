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

  test("counts how often replies followed a hint for less", () => {
    const summary = summarize([
      turn({ mood: "short" }),
      { ...answered(80, "approved", "short"), complied: true },
      { ...answered(300, "follow-up", "short"), complied: false },
      { ...answered(320, "follow-up", "short"), complied: false },
    ]);

    expect(summary.byLabel.short.followed).toEqual({ checked: 3, followed: 1 });
    expect(summary.byLabel.long.followed).toEqual({ checked: 0, followed: 0 });
  });

  test("prints how often the hint was followed, only where it was checked", () => {
    const lines = reportLines(
      summarize([
        turn({ mood: "short" }),
        { ...answered(80, "approved", "short"), complied: true },
        { ...answered(300, "follow-up", "short"), complied: false },
      ]),
      7
    );

    expect(lines.find((l) => l.startsWith("  short"))).toEndWith(" · followed 1 of 2");
    expect(lines).toContain("  long      no replies yet");
  });

  test("prints what gets approved, and says where the evidence is too thin", () => {
    const reacted = (n: number, approved: number, words: number) =>
      Array.from({ length: n }, (_, i) =>
        answered(words, i < approved ? "approved" : "follow-up")
      );
    const lines = reportLines(
      summarize([turn(), ...reacted(20, 10, 100), ...reacted(20, 2, 300)]),
      7
    );

    const at = lines.indexOf("What gets approved, from 40 reacted replies:");
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at + 1, at + 3)).toEqual([
      "  under 200 words: approved 50% of 20 · 200 words or more: 10% of 20",
      "  with a list: too few replies (0 against 40)",
    ]);
  });

  test("a narrow gap on enough replies reads as no real difference", () => {
    const reacted = (n: number, approved: number, asked: boolean) =>
      Array.from({ length: n }, (_, i) => ({
        ...answered(100, i < approved ? "approved" : "follow-up"),
        reply: { words: 100, listItems: 0, headings: 0, asked },
      }));
    const lines = reportLines(
      summarize([turn(), ...reacted(20, 5, true), ...reacted(20, 4, false)]),
      7
    );

    expect(lines).toContain(
      "  ending with a question: no real difference (25% of 20 against 20% of 20)"
    );
  });

  test("learns each channel apart in the report", () => {
    const lines = reportLines(
      summarize([turn(), { ...answered(100, "approved"), channel: "discord-mobile" }]),
      7
    );

    expect(lines).toContain("On discord-mobile, from 1 reacted reply:");
    expect(lines.some((l) => l.startsWith("On terminal"))).toBe(false);
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

  test("counts each agent's turns, the replies filed for them, and the hints sent", () => {
    const summary = summarize([
      turn({ runtime: "cursor", hinted: true }),
      { ...answered(80, "approved"), runtime: "cursor" },
      { ...turn({ runtime: "codex" }), session: "c" },
      turn({ runtime: undefined }),
    ]);

    expect(summary.agents).toEqual({
      cursor: { turns: 2, replies: 1, hints: 1 },
      codex: { turns: 1, replies: 0, hints: 0 },
      unknown: { turns: 1, replies: 0, hints: 0 },
    });
  });

  test("prints a line per agent, busiest first", () => {
    const lines = reportLines(
      summarize([
        turn({ runtime: "codex" }),
        { ...answered(80, "approved"), runtime: "claude" },
        { ...answered(80, "approved"), runtime: "claude", hinted: true },
      ]),
      7
    );

    expect(lines).toContain("By agent:");
    const at = lines.indexOf("By agent:");
    expect(lines.slice(at + 1, at + 3)).toEqual([
      "  claude    2 turns · 2 replies filed · 1 hint sent",
      "  codex     1 turn · 0 replies filed · 0 hints sent",
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
