import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIDENCE,
  type NoteFlagsResult,
  notesFromFlags,
  parseConfidence,
} from "../src/tools/lib/note-flags";

// The LEARN phase calls this tool to record what it noticed about the user. It
// is spawned, so what its flags mean was never asserted — including the one
// judgement that matters: a confidence it cannot read is a typo, and writing the
// note anyway under the default would record a claim nobody made.

/** Throws rather than returning the error branch, so a refusal cannot pass. */
function notes(result: NoteFlagsResult) {
  if ("error" in result) throw new Error(`refused: ${result.error}`);
  return result.notes;
}

describe("parseConfidence", () => {
  test("reads the number the caller gave", () => {
    expect(parseConfidence("0.8")).toBe(0.8);
    expect(parseConfidence("0")).toBe(0);
    expect(parseConfidence("1")).toBe(1);
  });

  test("falls back to the default when the caller said nothing", () => {
    expect(parseConfidence(undefined)).toBe(DEFAULT_CONFIDENCE);
  });

  // Null, not the default: a value that will not parse is a mistake in the
  // call, and treating it as "no value given" would silently invent one.
  test("refuses a value that is not a number", () => {
    expect(parseConfidence("high")).toBeNull();
    expect(parseConfidence("")).toBeNull();
  });

  test("refuses a value outside the scale it is on", () => {
    expect(parseConfidence("1.1")).toBeNull();
    expect(parseConfidence("-0.1")).toBeNull();
    expect(parseConfidence("80")).toBeNull();
  });
});

describe("notesFromFlags", () => {
  test("an opinion carries its confidence", () => {
    expect(
      notes(notesFromFlags({ o: ["prefers short answers"], confidence: "0.9" }))
    ).toEqual([{ type: "O", text: "prefers short answers", confidence: 0.9 }]);
  });

  test("an opinion with no confidence given takes the default", () => {
    expect(notes(notesFromFlags({ o: ["prefers short answers"] }))[0].confidence).toBe(
      DEFAULT_CONFIDENCE
    );
  });

  // A world fact is observable, so there is nothing to be confident about.
  test("a world fact carries no confidence at all", () => {
    const [note] = notes(notesFromFlags({ w: ["runs Bun 1.4"] }));
    expect(note).toEqual({ type: "W", text: "runs Bun 1.4" });
    expect("confidence" in note).toBe(false);
  });

  test("a session note is its own type", () => {
    expect(notes(notesFromFlags({ b: "split the cache logic" }))).toEqual([
      { type: "Session", text: "split the cache logic" },
    ]);
  });

  test("each --o and --w becomes its own note, not one joined together", () => {
    const drafts = notes(notesFromFlags({ o: ["a", "b"], w: ["c", "d", "e"] }));
    expect(drafts).toHaveLength(5);
    expect(drafts.filter((n) => n.type === "O")).toHaveLength(2);
    expect(drafts.filter((n) => n.type === "W")).toHaveLength(3);
  });

  test("every opinion in one call gets the same confidence", () => {
    const drafts = notes(notesFromFlags({ o: ["a", "b"], confidence: "0.6" }));
    expect(drafts.map((n) => n.confidence)).toEqual([0.6, 0.6]);
  });

  test("all three kinds can be written in a single call", () => {
    const drafts = notes(notesFromFlags({ o: ["a"], w: ["b"], b: "c" }));
    expect(drafts.map((n) => n.type)).toEqual(["O", "W", "Session"]);
  });

  describe("refusals", () => {
    test("a call with no note in it says so, rather than writing nothing quietly", () => {
      expect(notesFromFlags({})).toEqual({
        error: "Required: at least one of --o, --w, --b",
      });
    });

    // parseArgs hands back empty arrays for a repeated flag given no value.
    test("empty flag lists are the same as no flags", () => {
      expect(notesFromFlags({ o: [], w: [] })).toEqual({
        error: "Required: at least one of --o, --w, --b",
      });
    });

    test("an unreadable confidence refuses the whole call", () => {
      expect(notesFromFlags({ o: ["a"], confidence: "very" })).toEqual({
        error: "--confidence must be a number between 0.0 and 1.0",
      });
    });

    // The flag only qualifies --o, so it must not block a call that has none.
    test("a bad confidence does not block a call carrying no opinion", () => {
      expect(notes(notesFromFlags({ w: ["a"], confidence: "very" }))).toHaveLength(1);
    });

    test("an empty session note is no note", () => {
      expect(notesFromFlags({ b: "" })).toEqual({
        error: "Required: at least one of --o, --w, --b",
      });
    });
  });
});
