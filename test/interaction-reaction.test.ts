import { describe, expect, test } from "bun:test";
import { reactionTo, replyKeywords } from "../src/hooks/lib/interaction-reaction";

const REPLY = replyKeywords(
  "I moved the retry logic into the queue worker and the flaky upload test passes now."
);

function react(text: string, previousPrompt = "fix the flaky upload test") {
  return reactionTo(text, { previousPrompt, replyKeywords: REPLY });
}

describe("a reply's outcome, read from the next message", () => {
  test.each([
    "no, the other worker",
    "nope",
    "wrong.",
    "that's not what I asked",
    "I said the queue, not the worker",
    "still failing on CI",
  ])("corrected: %s", (text) => {
    expect(react(text)).toBe("corrected");
  });

  test.each([
    "wrong upload test first pls",
    "no problem, go on",
    "nothing else to add",
  ])("a word that only looks like a correction is not one: %s", (text) => {
    expect(react(text)).not.toBe("corrected");
  });

  test.each([
    "yes pls",
    "yyyyes",
    "great, merge it",
    "It works, well done",
    "that's it. also bump the version",
    "merge to main",
    "push and PR",
    "ok",
    "ok go",
  ])("approved: %s", (text) => {
    expect(react(text)).toBe("approved");
  });

  test.each([
    "ok, one windows test failed, check pls",
    "ok you are running on the new version",
    "good, but rename the worker first",
    "merge it once the staging deploy finished and the smoke tests are green",
  ])("an opener or a go-ahead with conditions is not approval: %s", (text) => {
    expect(react(text)).not.toBe("approved");
  });

  test("asking the same thing again is a repeat, even before approval words", () => {
    expect(
      react(
        "yes fix the flaky upload test in the queue worker",
        "fix the flaky upload test in the queue worker"
      )
    ).toBe("repeated");
  });

  test("a message about something else entirely is a new topic", () => {
    expect(react("what should the landing page headline say about pricing tiers")).toBe(
      "new-topic"
    );
  });

  test("a question about the reply is a follow-up", () => {
    expect(react("does the retry in the queue worker back off?")).toBe("follow-up");
  });
});
