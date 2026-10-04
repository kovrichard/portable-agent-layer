import { describe, expect, test } from "bun:test";
import { reactionTo } from "../src/hooks/lib/interaction-reaction";

function react(text: string, previousPrompt = "fix the flaky upload test") {
  return reactionTo(text, previousPrompt);
}

describe("a reply's outcome, read from the next message", () => {
  test.each([
    "no, the other worker",
    "nope",
    "wrong.",
    "that's not what I asked",
    "I said the queue, not the worker",
    "still failing on CI",
    "I think you are partially wrong about the retry",
    "you're wrong on the second point",
    "I don't see the retry change",
    "the retry fix isn't added yet, right?",
    "the queue change wasn't pushed",
  ])("corrected: %s", (text) => {
    expect(react(text)).toBe("corrected");
  });

  test.each([
    "wrong upload test first pls",
    "no problem, go on",
    "nothing else to add",
    "wait, why does the worker retry?",
    "I don't see why the worker retries",
    "I don't see any problem with it",
    "I don't see the point of a second queue",
    "you are not wrong about the retry",
    "the deploy isn't done yet, right?",
  ])("a word that only looks like a correction is not one: %s", (text) => {
    expect(react(text)).not.toBe("corrected");
  });

  test.each([
    "great, merge it",
    "It works, well done",
    "that's it. also bump the version",
    "looks right to me. go ahead with step 2 then",
    "understood, well done. Now go ahead with the queue fix. Staging deploys meanwhile",
    "got it, great",
    "Let's build that, good job",
    "perfect",
    "thanks",
    "sounds good",
    "that's fine",
  ])("approved, the result itself is accepted: %s", (text) => {
    expect(react(text)).toBe("approved");
  });

  test.each([
    "yes pls",
    "yyyyes",
    "sure",
    "merge to main",
    "push and PR",
    "ok",
    "ok go",
    "start building the first one",
    "fix all in separate commits",
    "add pls. the smaller model is fine",
    "yes, fix both. Then push. Also sketch the retry fix, but don't build it yet",
  ])("a go-ahead only gives permission to continue: %s", (text) => {
    expect(react(text)).toBe("go-ahead");
  });

  test.each([
    "ok, one windows test failed, check pls",
    "ok you are running on the new version",
    "good, but rename the worker first",
    "merge it once the staging deploy finished and the smoke tests are green",
    "good. does this cover the windows case?",
    "Merge failed",
    "push failed",
    "build is broken",
    "commit error",
    "add a retry to the fetch",
    "add pls. but use the smaller model",
    "push. the tests still need a rename though",
  ])("an opener, a failure report or a go-ahead with conditions is not approval: %s", (text) => {
    expect(["approved", "go-ahead"]).not.toContain(react(text));
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
