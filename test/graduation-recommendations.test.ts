import { describe, expect, test } from "bun:test";
import { generateRecommendations } from "../src/hooks/lib/graduation";
import type { inference } from "../src/hooks/lib/inference";

import { freshTestDir } from "./lib/test-home";

type Request = Parameters<typeof inference>[0];

const PRESERVED = ["PAL_AGENT", "PAL_ANTHROPIC_API_KEY", "PAL_OPENAI_API_KEY", "PATH"];

function group(pattern: string, occurrences: number, domain = "development") {
  const entries = Array.from({ length: occurrences }, (_, i) => ({
    source: `s${i}`,
    path: `p${i}`,
    text: pattern,
    date: "2026-03-01",
  }));

  return { pattern, entries, domain };
}

const RATINGS = {
  total: 12,
  average: 5.25,
  low: { count: 4, examples: [] },
  high: { count: 3, examples: [] },
};

function replying(output: string | undefined, success = true) {
  const requests: Request[] = [];
  const infer = async (request: Request) => {
    requests.push(request);

    return { success, output };
  };

  return { requests, deps: { canInfer: () => true, infer } };
}

const LONG = "x".repeat(150);

describe("generateRecommendations without inference", () => {
  test("returns nothing when there are no patterns and no ratings", async () => {
    const { requests, deps } = replying('{"recommendations":["a"]}');

    expect(await generateRecommendations([], null, deps)).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  test("names the first three patterns, cut to 80 chars, when it cannot infer", async () => {
    const groups = [group(LONG, 4), group("b", 3), group("c", 5), group("d", 6)];
    const { requests, deps } = replying('{"recommendations":["inferred"]}');
    const result = await generateRecommendations(groups, null, {
      ...deps,
      canInfer: () => false,
    });

    expect(requests).toHaveLength(0);

    expect(result).toEqual([
      `Address "${"x".repeat(80)}" (4 occurrences)`,
      'Address "b" (3 occurrences)',
      'Address "c" (5 occurrences)',
    ]);
  });

  test("by default asks the runtime whether it can infer", async () => {
    const saved = Object.fromEntries(PRESERVED.map((k) => [k, process.env[k]]));
    process.env.PATH = freshTestDir(import.meta.file);
    process.env.PAL_AGENT = "opencode";
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env.PAL_OPENAI_API_KEY;

    try {
      expect(await generateRecommendations([group("p", 3)], null)).toEqual([
        'Address "p" (3 occurrences)',
      ]);
    } finally {
      for (const k of PRESERVED) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});

describe("generateRecommendations with inference", () => {
  test("asks with the ratings and up to five patterns as context", async () => {
    const { requests, deps } = replying('{"recommendations":["one"]}');
    const groups = [1, 2, 3, 4, 5, 6].map((n) => group(`p${n}`, 3));
    groups[0] = group(LONG, 3, "workflow");

    await generateRecommendations(groups, RATINGS, deps);

    expect(requests[0].user).toBe(
      [
        "Average rating: 5.3/10 (12 total)",
        "Low ratings (≤4): 4 | High ratings (≥7): 3",
        "Recurring patterns:",
        `- [workflow] 3x: ${"x".repeat(100)}`,
        "- [development] 3x: p2",
        "- [development] 3x: p3",
        "- [development] 3x: p4",
        "- [development] 3x: p5",
      ].join("\n")
    );
  });

  test("leaves out the ratings lines and the patterns heading when absent", async () => {
    const ratingsOnly = replying('{"recommendations":["one"]}');
    await generateRecommendations([], RATINGS, ratingsOnly.deps);
    expect(ratingsOnly.requests[0].user).toBe(
      "Average rating: 5.3/10 (12 total)\nLow ratings (≤4): 4 | High ratings (≥7): 3"
    );

    const patternsOnly = replying('{"recommendations":["one"]}');
    await generateRecommendations([group("p", 3)], null, patternsOnly.deps);
    expect(patternsOnly.requests[0].user).toBe(
      "Recurring patterns:\n- [development] 3x: p"
    );
  });

  test("asks for a JSON recommendations array from the graduation caller", async () => {
    const { requests, deps } = replying('{"recommendations":["one"]}');
    await generateRecommendations([group("p", 3)], null, deps);

    expect(requests[0]).toMatchObject({
      maxTokens: 300,
      timeout: 15000,
      caller: "graduation",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: { recommendations: { type: "array", items: { type: "string" } } },
        required: ["recommendations"],
      },
    });
    expect(requests[0].system).toContain(
      "Generate 3-5 specific, actionable recommendations"
    );
  });

  test("returns at most five of the model's recommendations", async () => {
    const recs = ["r1", "r2", "r3", "r4", "r5", "r6"];
    const { deps } = replying(JSON.stringify({ recommendations: recs }));

    expect(await generateRecommendations([group("p", 3)], null, deps)).toEqual(
      recs.slice(0, 5)
    );
  });

  test("returns a single recommendation as given", async () => {
    const { deps } = replying('{"recommendations":["only"]}');

    expect(await generateRecommendations([group("p", 3)], null, deps)).toEqual(["only"]);
  });
});

describe("generateRecommendations falls back to the patterns", () => {
  const fallback = ['Address "p" (3 occurrences)'];

  test.each([
    ["the call fails", replying('{"recommendations":["r"]}', false)],
    ["the reply is empty", replying("")],
    ["the reply is not JSON", replying("not json")],
    ["the list is empty", replying('{"recommendations":[]}')],
    ["the list is missing", replying("{}")],
  ])("when %s", async (_, { deps }) => {
    expect(await generateRecommendations([group("p", 3)], null, deps)).toEqual(fallback);
  });

  test("when the call throws", async () => {
    const result = await generateRecommendations([group("p", 3)], null, {
      canInfer: () => true,
      infer: async () => {
        throw new Error("boom");
      },
    });

    expect(result).toEqual(fallback);
  });
});
