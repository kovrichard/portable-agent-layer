import { describe, expect, test } from "bun:test";
import {
  needsPraisedBehavior,
  parsePraisedBehavior,
  praisedBehaviorRequest,
  reinforcementDraft,
  withPraisedBehavior,
} from "../src/hooks/lib/praised-behavior";

const turn = {
  session: "s",
  message: "m",
  replyEnd: "r",
  reaction: "praised",
  issue: "",
};

describe("parsePraisedBehavior", () => {
  test("a repeatable behavior keeps its trimmed situation and steering", () => {
    const output = JSON.stringify({
      repeatable: true,
      when: " the user counter-proposes ",
      steering: " Argue again when a concrete flaw remains ",
      explicit: true,
    });
    expect(parsePraisedBehavior(output)).toEqual({
      behavior: {
        when: "the user counter-proposes",
        steering: "Argue again when a concrete flaw remains",
      },
      explicit: true,
    });
  });

  test("praise of the output itself is kept, with no behavior", () => {
    const output = JSON.stringify({
      repeatable: false,
      when: "",
      steering: "",
      explicit: false,
    });
    expect(parsePraisedBehavior(output)).toEqual({ explicit: false });
  });

  test("a behavior missing its steering counts as none", () => {
    const output = JSON.stringify({
      repeatable: true,
      when: "the user counter-proposes",
      steering: "",
      explicit: false,
    });
    expect(parsePraisedBehavior(output)).toEqual({ explicit: false });
  });

  test("no output or broken JSON is no answer", () => {
    expect(parsePraisedBehavior(null)).toBeNull();
    expect(parsePraisedBehavior("not json")).toBeNull();
  });
});

describe("which turns are read", () => {
  test("only praise", () => {
    expect(needsPraisedBehavior(turn)).toBe(true);
    expect(needsPraisedBehavior({ ...turn, reaction: "approved" })).toBe(false);
    expect(needsPraisedBehavior({ ...turn, reaction: "corrected" })).toBe(false);
    expect(needsPraisedBehavior(null)).toBe(false);
  });

  test("no answer leaves the turn as it was", () => {
    expect(withPraisedBehavior(turn, null)).toEqual(turn);
  });
});

test("the request carries the reply end and the praise", () => {
  const request = praisedBehaviorRequest("Upkeep is safer.", "love the pushback", "s1");
  expect(request.caller).toBe("praised-behavior");
  expect(request.user).toContain("Upkeep is safer.");
  expect(request.user).toContain("love the pushback");
});

describe("reinforcementDraft", () => {
  const behavior = { when: "the user counter-proposes", steering: "Argue again" };

  test("a praised behavior drafts a reinforcement with the praise as evidence", () => {
    expect(reinforcementDraft({ behavior, explicit: true }, "keep this up")).toEqual({
      ...behavior,
      polarity: "reinforce",
      evidence: ['Asked to keep it: "keep this up"'],
    });
    expect(reinforcementDraft({ behavior, explicit: false }, "nice")?.evidence).toEqual([
      'Praised: "nice"',
    ]);
  });

  test("praise of the output alone, or no answer, drafts nothing", () => {
    expect(reinforcementDraft({ explicit: true }, "love it")).toBeNull();
    expect(reinforcementDraft(null, "love it")).toBeNull();
  });
});
