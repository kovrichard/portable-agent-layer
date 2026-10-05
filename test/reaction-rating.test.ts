import { describe, expect, test } from "bun:test";
import {
  isCorrectionLabel,
  parseReactionLabel,
  ratingContext,
  ratingFromLabels,
  reactionRequest,
} from "../src/hooks/lib/reaction-rating";

const corrected = {
  reaction: "corrected" as const,
  issue: "claimed the file was cleaned up",
};
const repeated = { reaction: "repeated" as const, issue: "ignored the commit request" };
const praised = { reaction: "praised" as const, issue: "" };
const approved = { reaction: "approved" as const, issue: "" };
const followUp = { reaction: "follow-up" as const, issue: "" };

describe("parseReactionLabel", () => {
  test("reads the reaction and the issue", () => {
    expect(parseReactionLabel('{"reaction":"corrected","issue":" wrong path "}')).toEqual(
      {
        reaction: "corrected",
        issue: "wrong path",
      }
    );
  });

  test("rejects a label outside the set", () => {
    expect(parseReactionLabel('{"reaction":"angry","issue":""}')).toBeNull();
  });

  test("rejects output that is not JSON", () => {
    expect(parseReactionLabel("corrected")).toBeNull();
  });

  test("rejects a missing output", () => {
    expect(parseReactionLabel(undefined)).toBeNull();
  });

  test("an issue that is not a string becomes empty", () => {
    expect(parseReactionLabel('{"reaction":"follow-up","issue":3}')?.issue).toBe("");
  });
});

describe("isCorrectionLabel", () => {
  test("corrected and repeated are corrections", () => {
    expect(isCorrectionLabel(corrected)).toBe(true);
    expect(isCorrectionLabel(repeated)).toBe(true);
  });

  test("praise, approval and no label are not", () => {
    expect(isCorrectionLabel(praised)).toBe(false);
    expect(isCorrectionLabel(approved)).toBe(false);
    expect(isCorrectionLabel(null)).toBe(false);
  });
});

describe("ratingFromLabels", () => {
  test("a confirmed correction rates 3", () => {
    expect(ratingFromLabels(corrected, corrected)).toBe(3);
  });

  test("a confirmed repeat rates 2", () => {
    expect(ratingFromLabels(repeated, corrected)).toBe(2);
  });

  test("a correction the second label does not confirm carries no rating", () => {
    expect(ratingFromLabels(corrected, followUp)).toBeNull();
    expect(ratingFromLabels(corrected, null)).toBeNull();
  });

  test("praise rates 8 without a confirmation", () => {
    expect(ratingFromLabels(praised, null)).toBe(8);
  });

  test("a go-ahead or a follow-up carries no rating", () => {
    expect(ratingFromLabels(approved, null)).toBeNull();
    expect(ratingFromLabels(followUp, null)).toBeNull();
  });

  test("no label carries no rating", () => {
    expect(ratingFromLabels(null, null)).toBeNull();
  });
});

describe("ratingContext", () => {
  test("a correction leads with what the reply got wrong", () => {
    expect(ratingContext(corrected, "I don't see the cleanup")).toBe(
      "claimed the file was cleaned up: I don't see the cleanup"
    );
  });

  test("praise says so", () => {
    expect(ratingContext(praised, "well done")).toBe("Praised the reply: well done");
  });

  test("a correction without an issue falls back to its label", () => {
    expect(ratingContext({ reaction: "corrected", issue: "" }, "no")).toBe(
      "corrected: no"
    );
  });

  test("the message is cut at 200 characters", () => {
    expect(ratingContext(praised, "x".repeat(300))).toHaveLength(
      "Praised the reply: ".length + 200
    );
  });
});

describe("reactionRequest", () => {
  test("shows the model the end of the reply and the message", () => {
    const request = reactionRequest("Run acme sync.", "acme not found", "s1");
    expect(request.user).toContain("<reply_end>\nRun acme sync.\n</reply_end>");
    expect(request.user).toContain("<message>\nacme not found\n</message>");
    expect(request.sessionId).toBe("s1");
    expect(request.caller).toBe("rating");
  });

  test("keeps the whole reply end, where the claims and questions are", () => {
    const reply = `${"a".repeat(500)} Shall I commit?`;
    expect(reactionRequest(reply, "no").user).toContain(`${reply}\n</reply_end>`);
  });

  test("cuts the message at 800 characters", () => {
    const request = reactionRequest("reply", "y".repeat(900));
    expect(request.user).toContain(`${"y".repeat(800)}\n</message>`);
    expect(request.user).not.toContain("y".repeat(801));
  });
});
