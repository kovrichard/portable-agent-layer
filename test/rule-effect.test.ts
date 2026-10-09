import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Turn } from "../src/hooks/lib/adaptation-turns";
import {
  type RuleEvent,
  readRuleEvents,
  ruleEffects,
} from "../src/hooks/lib/rule-effect";
import { removeOnceReleased } from "./lib/remove-once-released";

const turn = (ts: string, over: Partial<Turn> = {}): Turn => ({
  ts,
  session: "s1",
  message: "next",
  replyEnd: "Done.",
  reaction: "follow-up",
  issue: "",
  ...over,
});

const fire = (ts: string, over: Partial<RuleEvent> = {}): RuleEvent => ({
  ts,
  rule: "r1",
  side: "prompt",
  session: "s1",
  ...over,
});

describe("ruleEffects", () => {
  test("the turn after a fire in its session judges the steered reply", () => {
    const turns = [
      turn("2026-10-07T10:00:00.000Z"),
      turn("2026-10-07T10:05:00.000Z", { reaction: "corrected", confirmed: true }),
      turn("2026-10-07T11:00:00.000Z"),
    ];
    const events = [fire("2026-10-07T10:00:00.100Z"), fire("2026-10-07T10:30:00.000Z")];

    expect(ruleEffects(events, turns).r1).toEqual({
      fired: 2,
      sentBack: 0,
      judged: 2,
      correctedAfter: 1,
    });
  });

  test("turns from other sessions do not judge a fire", () => {
    const turns = [
      turn("2026-10-07T10:05:00.000Z", {
        session: "other",
        reaction: "corrected",
        confirmed: true,
      }),
    ];

    expect(ruleEffects([fire("2026-10-07T10:00:00.000Z")], turns).r1).toEqual({
      fired: 1,
      sentBack: 0,
      judged: 0,
      correctedAfter: 0,
    });
  });

  test("an unconfirmed correction after a fire does not count", () => {
    const turns = [
      turn("2026-10-07T10:05:00.000Z", { reaction: "corrected", confirmed: false }),
    ];

    expect(ruleEffects([fire("2026-10-07T10:00:00.000Z")], turns).r1.correctedAfter).toBe(
      0
    );
  });

  test("replies sent back are counted per rule", () => {
    const events = [
      fire("2026-10-07T10:00:00.000Z", { side: "reply", sentBack: true }),
      fire("2026-10-07T10:01:00.000Z", { side: "reply", sentBack: false }),
      fire("2026-10-07T10:02:00.000Z", { rule: "r2" }),
    ];

    const effects = ruleEffects(events, []);

    expect(effects.r1.sentBack).toBe(1);
    expect(effects.r2.fired).toBe(1);
  });
});

describe("readRuleEvents", () => {
  let HOME: string;

  beforeEach(() => {
    HOME = mkdtempSync(resolve(tmpdir(), "pal-rule-effect-"));
    process.env.PAL_HOME = HOME;
  });

  afterEach(() => {
    delete process.env.PAL_HOME;
    removeOnceReleased(HOME);
  });

  test("no log reads as no events", () => {
    expect(readRuleEvents()).toEqual([]);
  });

  test("only events inside the window are read, broken lines skipped", () => {
    mkdirSync(resolve(HOME, "memory", "adaptation"), { recursive: true });
    writeFileSync(
      resolve(HOME, "memory", "adaptation", "rule-events.jsonl"),
      [
        JSON.stringify(fire("2026-08-01T10:00:00.000Z", { rule: "old" })),
        "{ broken",
        JSON.stringify(fire("2026-10-06T10:00:00.000Z", { rule: "new" })),
      ].join("\n")
    );

    expect(
      readRuleEvents(30, new Date("2026-10-07T00:00:00Z")).map((e) => e.rule)
    ).toEqual(["new"]);
  });
});
