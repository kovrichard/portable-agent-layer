import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { captureRating, parseExplicitRating } from "../src/hooks/handlers/rating";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-rating");

describe("captureRating non-blocking contract", () => {
  let savedKey: string | undefined;
  let savedAgent: string | undefined;
  let savedHome: string | undefined;
  beforeEach(() => {
    savedKey = process.env.PAL_ANTHROPIC_API_KEY;
    savedAgent = process.env.PAL_AGENT;
    savedHome = process.env.PAL_HOME;
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
    mkdirSync(TEST_HOME, { recursive: true });
    process.env.PAL_ANTHROPIC_API_KEY = "sk-test-would-route-to-api";
    process.env.PAL_AGENT = "claude";
    process.env.PAL_HOME = TEST_HOME;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.PAL_ANTHROPIC_API_KEY;
    else process.env.PAL_ANTHROPIC_API_KEY = savedKey;
    if (savedAgent === undefined) delete process.env.PAL_AGENT;
    else process.env.PAL_AGENT = savedAgent;
    if (savedHome === undefined) delete process.env.PAL_HOME;
    else process.env.PAL_HOME = savedHome;
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  });

  test("returns synchronously when implicit-sentiment path is triggered", () => {
    // A non-praise, non-system, sane-length message that previously would have
    // awaited an inference call inline. After the detach refactor, the parent
    // must return immediately — the inference happens in a spawned subprocess.
    const start = Date.now();
    captureRating("I really like the structure of this implementation", "sess-test");
    const elapsed = Date.now() - start;
    // Allow generous headroom for spawn() syscall itself; inference would be 3-30s.
    expect(elapsed).toBeLessThan(100);
  });

  test("praise fast-path also returns synchronously", () => {
    const start = Date.now();
    captureRating("nice work", "sess-test");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  test("explicit rating returns synchronously", () => {
    const start = Date.now();
    captureRating("8 great", "sess-test");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

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
