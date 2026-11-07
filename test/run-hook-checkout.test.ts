import { describe, expect, test } from "bun:test";
import { kindOfCheckout } from "../.agents/hooks/run-hook";

describe("kindOfCheckout", () => {
  test("a git dir equal to the common dir is the main checkout", () => {
    expect(kindOfCheckout("/r/.git", "/r/.git")).toBe("main");
  });

  test("a git dir under the common dir's worktrees is a linked worktree", () => {
    expect(kindOfCheckout("/r/.git/worktrees/w", "/r/.git")).toBe("linked");
  });

  test("a missing git dir gives null", () => {
    expect(kindOfCheckout(null, "/r/.git")).toBeNull();
  });

  test("a missing common dir gives null", () => {
    expect(kindOfCheckout("/r/.git", null)).toBeNull();
  });

  test("both dirs missing gives null", () => {
    expect(kindOfCheckout(null, null)).toBeNull();
  });
});
