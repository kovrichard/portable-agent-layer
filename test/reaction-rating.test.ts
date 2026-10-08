import { describe, expect, test } from "bun:test";
import {
  correctionCheckRequest,
  isCorrectionLabel,
  needsCorrectionCheck,
  parseCorrectionCheck,
  parseReactionLabel,
  ratingContext,
  ratingFromLabels,
  reactionRequest,
  settledLabel,
  turnFromLabels,
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

describe("turnFromLabels", () => {
  const seen = { session: "s1", message: "no, wrong file", replyEnd: "Cleaned it up." };

  test("a confirmed correction is logged as confirmed", () => {
    expect(turnFromLabels(seen, corrected, repeated)).toEqual({
      ...seen,
      reaction: "corrected",
      issue: "claimed the file was cleaned up",
      confirmed: true,
    });
  });

  test("a correction the second label disagreed with is logged as unconfirmed", () => {
    expect(turnFromLabels(seen, corrected, praised)?.confirmed).toBe(false);
  });

  test("any other reaction is logged without a confirmation flag", () => {
    expect(turnFromLabels(seen, praised, null)).toEqual({
      ...seen,
      reaction: "praised",
      issue: "",
    });
  });

  test("no label means nothing to log", () => {
    expect(turnFromLabels(seen, null, null)).toBeNull();
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

describe("correctionCheckRequest", () => {
  test("asks a question of its own about the same reply and message", () => {
    const request = correctionCheckRequest("Run acme sync.", "acme not found", "s1");
    const labelling = reactionRequest("Run acme sync.", "acme not found", "s1");
    expect(request.user.startsWith(labelling.user)).toBe(true);
    expect(request.system).not.toBe(labelling.system);
    expect(request.jsonSchema.properties.reaction.enum).toEqual([
      "corrected",
      "not-corrected",
    ]);
    expect(request.sessionId).toBe("s1");
    expect(request.caller).toBe("rating");
  });

  test("asks for the answer after the message, where it was evaluated", () => {
    const request = correctionCheckRequest("Run acme sync.", "acme not found");
    expect(request.user.indexOf("Answer corrected")).toBeGreaterThan(
      request.user.indexOf("</message>")
    );
    expect(request.system).not.toContain("Answer corrected");
  });
});

describe("parseCorrectionCheck", () => {
  test("a correction keeps what the reply got wrong", () => {
    expect(
      parseCorrectionCheck('{"reaction":"corrected","issue":" wrong flag "}')
    ).toEqual({ reaction: "corrected", issue: "wrong flag" });
  });

  test("anything else reads as a follow-up", () => {
    expect(parseCorrectionCheck('{"reaction":"not-corrected","issue":"x"}')).toEqual(
      followUp
    );
  });

  test("output that is not JSON is no answer", () => {
    expect(parseCorrectionCheck("corrected")).toBeNull();
    expect(parseCorrectionCheck(undefined)).toBeNull();
  });
});

describe("needsCorrectionCheck", () => {
  test("a correction, a repeat and a follow-up are checked", () => {
    expect(needsCorrectionCheck(corrected)).toBe(true);
    expect(needsCorrectionCheck(repeated)).toBe(true);
    expect(needsCorrectionCheck(followUp)).toBe(true);
  });

  test("praise, approval, a new topic and no label are not", () => {
    expect(needsCorrectionCheck(praised)).toBe(false);
    expect(needsCorrectionCheck(approved)).toBe(false);
    expect(needsCorrectionCheck({ reaction: "new-topic", issue: "" })).toBe(false);
    expect(needsCorrectionCheck(null)).toBe(false);
  });
});

describe("settledLabel", () => {
  const caught = { reaction: "corrected" as const, issue: "the flag does not exist" };

  test("a follow-up the check calls a correction becomes that correction", () => {
    expect(settledLabel(followUp, caught)).toEqual(caught);
  });

  test("a follow-up the check clears stays a follow-up", () => {
    expect(settledLabel(followUp, followUp)).toEqual(followUp);
    expect(settledLabel(followUp, null)).toEqual(followUp);
  });

  test("any other first label stands, and the check only confirms it", () => {
    expect(settledLabel(corrected, followUp)).toEqual(corrected);
    expect(settledLabel(repeated, caught)).toEqual(repeated);
    expect(settledLabel(null, caught)).toBeNull();
  });

  test("a follow-up caught by the check rates and logs as a confirmed correction", () => {
    const label = settledLabel(followUp, caught);
    expect(ratingFromLabels(label, caught)).toBe(3);
    expect(
      turnFromLabels({ session: "s", message: "m", replyEnd: "r" }, label, caught)
    ).toEqual({
      session: "s",
      message: "m",
      replyEnd: "r",
      reaction: "corrected",
      issue: "the flag does not exist",
      confirmed: true,
    });
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
