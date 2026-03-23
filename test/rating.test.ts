import { describe, expect, test } from "bun:test";
import { parseExplicitRating } from "../src/hooks/handlers/rating";

describe("parseExplicitRating", () => {
  // Valid ratings
  test("bare number", () => {
    expect(parseExplicitRating("7")).toEqual({ rating: 7, comment: undefined });
  });

  test("number with dash comment", () => {
    expect(parseExplicitRating("8 - great work")).toEqual({
      rating: 8,
      comment: "great work",
    });
  });

  test("number with colon comment", () => {
    expect(parseExplicitRating("6: needs work")).toEqual({
      rating: 6,
      comment: "needs work",
    });
  });

  test("number with comma comment", () => {
    expect(parseExplicitRating("6, needs work")).toEqual({
      rating: 6,
      comment: "needs work",
    });
  });

  test("10", () => {
    expect(parseExplicitRating("10")).toEqual({ rating: 10, comment: undefined });
  });

  test("number with space comment", () => {
    expect(parseExplicitRating("2 you deleted my file")).toEqual({
      rating: 2,
      comment: "you deleted my file",
    });
  });

  // Item selections — must NOT be treated as ratings
  test("rejects '1 and 2'", () => {
    expect(parseExplicitRating("1 and 2")).toBeNull();
  });

  test("rejects '2 3 5'", () => {
    expect(parseExplicitRating("2 3 5")).toBeNull();
  });

  test("rejects '1, 3, 5'", () => {
    expect(parseExplicitRating("1, 3, 5")).toBeNull();
  });

  test("rejects '1-3'", () => {
    expect(parseExplicitRating("1-3")).toBeNull();
  });

  test("rejects 'and 2'", () => {
    expect(parseExplicitRating("and 2")).toBeNull();
  });

  // Existing rejections
  test("rejects '3 items'", () => {
    expect(parseExplicitRating("3 items")).toBeNull();
  });

  test("rejects '7th thing'", () => {
    expect(parseExplicitRating("7th thing")).toBeNull();
  });

  test("rejects '10/10'", () => {
    expect(parseExplicitRating("10/10")).toBeNull();
  });

  test("rejects '3.5'", () => {
    expect(parseExplicitRating("3.5")).toBeNull();
  });

  test("rejects non-numeric", () => {
    expect(parseExplicitRating("hello")).toBeNull();
  });
});
