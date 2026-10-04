import { describe, expect, test } from "bun:test";
import type { TurnEvent } from "../src/hooks/lib/interaction";
import {
  isEvidence,
  type Split,
  shorterApprovedMore,
  splits,
} from "../src/hooks/lib/interaction-preferences";

interface Shape {
  words?: number;
  listItems?: number;
  headings?: number;
  asked?: boolean;
}

function reacted(approved: boolean, shape: Shape = {}): TurnEvent {
  return {
    ts: "2026-10-01T08:00:00.000Z",
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
    reply: {
      words: shape.words ?? 200,
      listItems: shape.listItems ?? 0,
      headings: shape.headings ?? 0,
      asked: shape.asked ?? false,
    },
    reaction: approved ? "approved" : "follow-up",
  };
}

function many(n: number, approved: number, shape: Shape): TurnEvent[] {
  return Array.from({ length: n }, (_, i) => reacted(i < approved, shape));
}

function split(events: TurnEvent[], shape: string): Split {
  const found = splits(events).find((s) => s.shape === shape);
  if (!found) throw new Error(`no split for ${shape}`);
  return found;
}

describe("learning what replies get approved", () => {
  test("splits the replies at their median length and counts approvals on each side", () => {
    const events = [...many(25, 10, { words: 100 }), ...many(25, 5, { words: 300 })];

    expect(split(events, "under 200 words")).toMatchObject({
      opposite: "200 words or more",
      has: { replies: 25, approved: 10 },
      lacks: { replies: 25, approved: 5 },
    });
  });

  test("a reply exactly at the median is not under it", () => {
    const events = [
      reacted(true, { words: 100 }),
      reacted(true, { words: 200 }),
      reacted(true, { words: 300 }),
    ];

    expect(split(events, "under 200 words").has.replies).toBe(1);
  });

  test("compares replies with lists, headings, and a closing question against those without", () => {
    const events = [
      ...many(4, 3, { listItems: 2 }),
      ...many(3, 1, { headings: 1 }),
      ...many(2, 2, { asked: true }),
    ];

    expect(split(events, "with a list").has).toEqual({ replies: 4, approved: 3 });
    expect(split(events, "with headings").has).toEqual({ replies: 3, approved: 1 });
    expect(split(events, "ending with a question").has).toEqual({
      replies: 2,
      approved: 2,
    });
    expect(split(events, "ending with a question").lacks).toEqual({
      replies: 7,
      approved: 4,
    });
  });

  test("a turn with no reply or no reaction teaches nothing", () => {
    const events = [
      reacted(true),
      { ...reacted(true), reaction: null },
      { ...reacted(true), reply: null },
    ];

    expect(split(events, "with a list").lacks.replies).toBe(1);
  });

  test("a clear gap on enough replies on both sides is evidence", () => {
    const events = [...many(20, 8, { words: 100 }), ...many(20, 4, { words: 300 })];

    expect(isEvidence(split(events, "under 200 words"))).toBe(true);
  });

  test("too few replies on one side is not evidence, however wide the gap", () => {
    const events = [...many(19, 19, { listItems: 1 }), ...many(40, 0, {})];

    expect(isEvidence(split(events, "with a list"))).toBe(false);
  });

  test("a gap under ten points is not evidence, however many replies", () => {
    const events = [...many(100, 30, { asked: true }), ...many(100, 21, {})];

    expect(isEvidence(split(events, "ending with a question"))).toBe(false);
  });
});

describe("evidence for asking less", () => {
  test("names the length split when shorter replies are approved clearly more", () => {
    const events = [...many(20, 8, { words: 100 }), ...many(20, 2, { words: 300 })];

    expect(shorterApprovedMore(events)).toMatchObject({ shape: "under 200 words" });
  });

  test("says nothing when longer replies are the approved ones", () => {
    const events = [...many(20, 2, { words: 100 }), ...many(20, 8, { words: 300 })];

    expect(shorterApprovedMore(events)).toBeNull();
  });

  test("says nothing without evidence", () => {
    const events = [...many(5, 5, { words: 100 }), ...many(5, 0, { words: 300 })];

    expect(shorterApprovedMore(events)).toBeNull();
  });
});
