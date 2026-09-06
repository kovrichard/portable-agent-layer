import { describe, expect, test } from "bun:test";
import { timezoneProblem } from "../src/cli/setup-identity";

// The install prompt prefills the machine's guess, and clack validates the raw
// keystrokes before it substitutes that default — so empty has to be accepted
// or Enter would stop working.

describe("the install timezone prompt", () => {
  test("accepts empty, which is how Enter keeps the prefilled guess", () => {
    expect(timezoneProblem("")).toBeUndefined();
    expect(timezoneProblem(undefined)).toBeUndefined();
  });

  test("accepts an IANA zone", () => {
    expect(timezoneProblem("Europe/Budapest")).toBeUndefined();
    expect(timezoneProblem("UTC")).toBeUndefined();
  });

  test("rejects a zone Intl does not recognise, naming what was typed", () => {
    expect(timezoneProblem("Mars/Olympus_Mons")).toContain("Mars/Olympus_Mons");
  });

  test("rejects a plausible-looking abbreviation", () => {
    expect(timezoneProblem("CET+2")).toBeDefined();
  });
});
