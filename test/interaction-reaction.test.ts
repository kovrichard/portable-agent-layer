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
    "start building the first one",
    "fix all in separate commits",
    "looks right to me. go ahead with step 2 then",
  ])("approved: %s", (text) => {
    expect(react(text)).toBe("approved");
  });

  test.each([
    "ok, one windows test failed, check pls",
    "ok you are running on the new version",
    "good, but rename the worker first",
    "merge it once the staging deploy finished and the smoke tests are green",
    "good. does this cover the windows case?",
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

  test.each([
    "new task: the landing page needs a pricing table",
    "new in between task: the deploy script skips staging",
    "unrelated question, how do we rotate the api keys?",
    "ok, different topic: the invoice export",
  ])("a message that says it changes the subject is a new topic: %s", (text) => {
    expect(react(text)).toBe("new-topic");
  });

  test.each([
    "what should the landing page headline say about pricing tiers",
    "all done? what would you add to the dashboard next, my goal is fewer manual checks",
    "merge failed again, now on three CI runners",
  ])("few shared words alone is not a new topic: %s", (text) => {
    expect(react(text)).toBe("follow-up");
  });

  test("a question about the reply is a follow-up", () => {
    expect(react("does the retry in the queue worker back off?")).toBe("follow-up");
  });
});
