import { describe, expect, test } from "bun:test";
import { type GoalLinks, linkInputs, progressFor } from "../src/hooks/lib/goal-links";

// The model draws the linkage; this counts it. Everything asserted here runs
// with no inference at all, which is also what the page falls back to when a
// linkage has never been written.

function links(entries: [string, string[]][]): GoalLinks {
  return {
    generatedAt: "2026-09-06T00:00:00.000Z",
    inputs: "x",
    links: entries.map(([goalId, projects]) => ({ goalId, projects })),
  };
}

const criteria = new Map([
  ["alpha", { closed: 3, written: 5 }],
  ["beta", { closed: 4, written: 6 }],
]);

describe("progressFor", () => {
  test("adds up the criteria of every project serving the goal", () => {
    expect(progressFor("ship", links([["ship", ["alpha", "beta"]]]), criteria)).toEqual({
      projects: ["alpha", "beta"],
      closed: 7,
      written: 11,
    });
  });

  test("a goal nothing serves has no progress rather than zero", () => {
    expect(progressFor("ship", links([["ship", []]]), criteria)).toBeNull();
  });

  test("a goal the linkage never mentioned has no progress", () => {
    expect(progressFor("talk", links([["ship", ["alpha"]]]), criteria)).toBeNull();
  });

  test("a linkage that has never run leaves every goal without progress", () => {
    expect(progressFor("ship", null, criteria)).toBeNull();
  });

  test("a project that has since been deleted is dropped, not counted as zero", () => {
    expect(progressFor("ship", links([["ship", ["alpha", "gone"]]]), criteria)).toEqual({
      projects: ["alpha"],
      closed: 3,
      written: 5,
    });
  });
});

describe("linkInputs", () => {
  test("order does not change the fingerprint", () => {
    expect(linkInputs(["a", "b"], ["x", "y"])).toBe(linkInputs(["b", "a"], ["y", "x"]));
  });

  test("a new goal or a new project does change it", () => {
    const base = linkInputs(["a"], ["x"]);
    expect(linkInputs(["a", "b"], ["x"])).not.toBe(base);
    expect(linkInputs(["a"], ["x", "y"])).not.toBe(base);
  });
});
