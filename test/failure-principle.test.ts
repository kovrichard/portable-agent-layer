import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  mergeInferredPrinciple,
  needsInference,
  type PendingFailure,
  principleRequest,
  recentExchange,
} from "../src/hooks/lib/failure-principle";

// A low rating is the one signal that says the session went wrong, and this is
// what PAL does with it. It runs detached — claude --print's cold start outruns
// the Stop hook's budget — so until now none of it could be asserted.

const PENDING: PendingFailure = {
  rating: 3,
  context: "answered a different question than the one asked",
};

function transcriptOf(...messages: { role: string; content: string }[]): string {
  return JSON.stringify(messages);
}

describe("recentExchange", () => {
  test("names each speaker, so the model can tell the two apart", () => {
    const digest = recentExchange(
      transcriptOf(
        { role: "user", content: "why" },
        { role: "assistant", content: "because" }
      )
    );
    expect(digest).toBe("USER: why\n\nASSISTANT: because");
  });

  test("keeps the last ten messages — the ending is where the failure is", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      role: "user",
      content: `m${i}`,
    }));
    const digest = recentExchange(transcriptOf(...many));
    expect(digest.split("\n\n")).toHaveLength(10);
    expect(digest).toContain("m24");
    expect(digest).not.toContain("m14");
  });

  // Otherwise one pasted stack trace crowds the other nine messages out.
  test("caps each message, rather than the digest as a whole", () => {
    const digest = recentExchange(
      transcriptOf(
        { role: "user", content: "x".repeat(900) },
        { role: "assistant", content: "the reply" }
      )
    );
    expect(digest).toContain("x".repeat(300));
    expect(digest).not.toContain("x".repeat(301));
    expect(digest).toContain("the reply");
  });

  test("a transcript that will not parse is an empty digest, not a throw", () => {
    expect(recentExchange("{not json")).toBe("");
    expect(recentExchange("")).toBe("");
  });
});

describe("needsInference", () => {
  test("is true when the parent had no principle to offer", () => {
    expect(needsInference(PENDING)).toBe(true);
  });

  test("is false once one exists — there is nothing left to ask", () => {
    expect(needsInference({ ...PENDING, principle: "Ask before assuming." })).toBe(false);
  });

  test("an empty principle is no principle, so it still asks", () => {
    expect(needsInference({ ...PENDING, principle: "" })).toBe(true);
  });
});

describe("principleRequest", () => {
  test("puts the rating in the question — a 1 and a 5 are different failures", () => {
    expect(principleRequest({ ...PENDING, rating: 1 }, "").system).toContain("1/10");
    expect(principleRequest({ ...PENDING, rating: 5 }, "").system).toContain("5/10");
  });

  test("carries both the user's own words and the conversation", () => {
    const request = principleRequest(PENDING, "USER: why");
    expect(request.user).toContain("answered a different question than the one asked");
    expect(request.user).toContain("USER: why");
  });

  // The schema is what makes the answer parseable at all. Without both fields
  // required, a reply carrying only a principle validates and the detailed
  // context is lost; without the types, nothing constrains the shape.
  test("pins the shape of the answer, field by field", () => {
    expect(principleRequest(PENDING, "").jsonSchema).toEqual({
      type: "object",
      properties: {
        principle: { type: "string" },
        detailed_context: { type: "string" },
      },
      required: ["principle", "detailed_context"],
      additionalProperties: false,
    });
  });

  test("is attributed, so its cost lands against this caller", () => {
    expect(principleRequest(PENDING, "").caller).toBe("failure-principle");
  });
});

describe("mergeInferredPrinciple", () => {
  const OUTPUT = JSON.stringify({
    principle: "State the assumption before acting on it.",
    detailed_context: "The request was ambiguous and one reading was picked silently.",
  });

  test("takes both fields from the answer when the parent had neither", () => {
    expect(mergeInferredPrinciple(PENDING, OUTPUT)).toEqual({
      principle: "State the assumption before acting on it.",
      detailedContext: "The request was ambiguous and one reading was picked silently.",
    });
  });

  // The two resolve differently on purpose: a context the parent already wrote
  // came from the whole session, not from ten messages.
  test("keeps the parent's detailed context over the inferred one", () => {
    const pending = { ...PENDING, detailedContext: "written from the full session" };
    expect(mergeInferredPrinciple(pending, OUTPUT).detailedContext).toBe(
      "written from the full session"
    );
  });

  test("keeps the parent's principle over the inferred one", () => {
    const pending = { ...PENDING, principle: "already known" };
    expect(mergeInferredPrinciple(pending, OUTPUT).principle).toBe("already known");
  });

  test("no answer leaves the parent's own values untouched", () => {
    const pending = { ...PENDING, detailedContext: "kept" };
    expect(mergeInferredPrinciple(pending, null)).toEqual({
      principle: undefined,
      detailedContext: "kept",
    });
  });

  test("an unparseable answer is dropped rather than throwing at the caller", () => {
    expect(mergeInferredPrinciple(PENDING, "sorry, I can't do that")).toEqual({
      principle: undefined,
      detailedContext: undefined,
    });
  });

  // A record whose principle is "" reads as one that was analysed and produced
  // nothing, which is not the same as one still waiting to be.
  test("an empty string in the answer is no answer", () => {
    const empty = JSON.stringify({ principle: "", detailed_context: "" });
    expect(mergeInferredPrinciple(PENDING, empty)).toEqual({
      principle: undefined,
      detailedContext: undefined,
    });
  });

  test("a well-formed answer missing a field yields undefined, not null", () => {
    const partial = JSON.stringify({ principle: "Verify before asserting." });
    expect(mergeInferredPrinciple(PENDING, partial)).toEqual({
      principle: "Verify before asserting.",
      detailedContext: undefined,
    });
  });
});

// The handler around the decisions above. Its inputs are two tmp files the
// parent wrote, and it owns their cleanup — a child that leaves them behind
// leaks a transcript into tmp on every low rating.
describe("processFailurePrinciple", () => {
  let HOME: string;

  beforeEach(async () => {
    HOME = mkdtempSync(resolve(tmpdir(), "pal-failure-"));
    process.env.PAL_HOME = HOME;
    (await import("../src/hooks/lib/settings")).reload();
  });

  afterEach(() => {
    delete process.env.PAL_HOME;
    rmSync(HOME, { recursive: true, force: true });
  });

  async function handler() {
    return (await import("../src/hooks/handlers/failure-principle"))
      .processFailurePrinciple;
  }

  test("a missing input file is logged and returns, rather than throwing", async () => {
    await (await handler())(resolve(HOME, "gone.json"), resolve(HOME, "gone.txt"));
  });

  test("unlinks both tmp files, so a transcript is not left in tmp", async () => {
    const pendingPath = resolve(HOME, "pending.json");
    const transcriptPath = resolve(HOME, "transcript.json");
    writeFileSync(
      pendingPath,
      JSON.stringify({ ...PENDING, principle: "Ask first." }),
      "utf-8"
    );
    writeFileSync(transcriptPath, transcriptOf({ role: "user", content: "hi" }), "utf-8");

    await (await handler())(pendingPath, transcriptPath);

    expect(existsSync(pendingPath)).toBe(false);
    expect(existsSync(transcriptPath)).toBe(false);
  });
});
