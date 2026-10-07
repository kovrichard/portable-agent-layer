import { describe, expect, test } from "bun:test";
import type { Turn } from "../src/hooks/lib/adaptation-turns";
import {
  canRepeat,
  correctionsToDraftFrom,
  drafterRequest,
  parseDraft,
} from "../src/hooks/lib/rule-drafter";

const turn = (over: Partial<Turn>): Turn => ({
  ts: "2026-10-07T08:00:00.000Z",
  session: "s1",
  message: "next step please",
  replyEnd: "Done.",
  reaction: "follow-up",
  issue: "",
  ...over,
});

const correction = (over: Partial<Turn>): Turn =>
  turn({ reaction: "corrected", issue: "claimed tests pass", confirmed: true, ...over });

const draft = {
  recurring: true,
  reason: "Both claim success without a run.",
  when: "Reporting that tests pass",
  side: "reply",
  pattern: "tests? pass",
  steering: "Run the tests before saying they pass.",
  check: "The reply quotes a test run.",
  cites: [0, 1],
};

const two = [
  { ...correction({ message: "they never ran" }), prompt: "" },
  { ...correction({ message: "you did not run them" }), prompt: "" },
];

describe("correctionsToDraftFrom", () => {
  test("keeps confirmed corrections, newest last, with the request they answered", () => {
    const turns = [
      turn({ ts: "2026-10-01T10:00:00Z", session: "a", message: "add the test" }),
      correction({ ts: "2026-10-01T10:05:00Z", session: "a", message: "wrong" }),
      correction({ ts: "2026-10-02T10:00:00Z", session: "b", message: "no" }),
      correction({ ts: "2026-10-03T10:00:00Z", confirmed: false }),
      turn({ ts: "2026-10-03T11:00:00Z", reaction: "approved" }),
    ];

    expect(correctionsToDraftFrom(turns).map((c) => [c.message, c.prompt])).toEqual([
      ["wrong", "add the test"],
      ["no", ""],
    ]);
  });

  test("a request from another session is not taken as the one answered", () => {
    const turns = [
      turn({ session: "other", message: "unrelated" }),
      correction({ session: "s1" }),
    ];

    expect(correctionsToDraftFrom(turns)[0].prompt).toBe("");
  });
});

describe("canRepeat", () => {
  test("one correction cannot be a repeat, two can", () => {
    expect(canRepeat(two.slice(0, 1))).toBe(false);
    expect(canRepeat(two)).toBe(true);
  });
});

describe("drafterRequest", () => {
  test("numbers the corrections and marks the newest", () => {
    const request = drafterRequest(two, []);

    expect(request.user).toContain('<correction n="0">');
    expect(request.user).toContain('<correction n="1" newest="true">');
    expect(request.user).toContain("you did not run them");
    expect(request.tier).toBe("small");
  });

  test("lists the rules that are already known", () => {
    const request = drafterRequest(two, [
      { when: "Deleting files", steering: "Ask first.", status: "denied" },
    ]);

    expect(request.user).toContain("denied: Deleting files. Ask first.");
  });
});

describe("parseDraft", () => {
  test("a recurring draft becomes a candidate citing its corrections", () => {
    expect(parseDraft(JSON.stringify(draft), two)).toEqual({
      when: "Reporting that tests pass",
      trigger: { side: "reply", pattern: "tests? pass" },
      steering: "Run the tests before saying they pass.",
      check: "The reply quotes a test run.",
      evidence: [
        "claimed tests pass: they never ran",
        "claimed tests pass: you did not run them",
      ],
    });
  });

  test("nothing recurring means no candidate", () => {
    expect(parseDraft(JSON.stringify({ ...draft, recurring: false }), two)).toBeNull();
  });

  test("a draft citing a single correction is not a pattern", () => {
    expect(parseDraft(JSON.stringify({ ...draft, cites: [1, 1] }), two)).toBeNull();
  });

  test("a draft that leaves out the newest correction is not about it", () => {
    const three = [...two, two[0]];
    expect(parseDraft(JSON.stringify(draft), three)).toBeNull();
  });

  test("a citation outside the list is rejected", () => {
    expect(parseDraft(JSON.stringify({ ...draft, cites: [1, 5] }), two)).toBeNull();
  });

  test("a pattern written as a /literal/ is stored as its bare expression", () => {
    const output = JSON.stringify({ ...draft, pattern: "/tests?\\s+pass/i" });
    expect(parseDraft(output, two)?.trigger.pattern).toBe("tests?\\s+pass");
  });

  test("a pattern that is not a valid expression is rejected", () => {
    expect(
      parseDraft(JSON.stringify({ ...draft, pattern: "tests (pass" }), two)
    ).toBeNull();
  });

  test("an empty instruction is rejected", () => {
    expect(parseDraft(JSON.stringify({ ...draft, steering: " " }), two)).toBeNull();
  });

  test("output that is not JSON is rejected", () => {
    expect(parseDraft("recurring", two)).toBeNull();
  });
});
