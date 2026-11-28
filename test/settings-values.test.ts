import { describe, expect, test } from "bun:test";
import type { SchemaNode } from "../src/cli/doctor/state";
import { settingsValueProblems } from "../src/cli/settings-values";

const schema: SchemaNode = {
  type: "object",
  properties: {
    name: { type: "string" },
    ratio: { type: "number", minimum: 0, maximum: 1 },
    days: { type: "integer", minimum: 1, maximum: 365 },
    tags: { type: "array", items: { type: "string" } },
    modes: { type: "object", additionalProperties: { enum: ["shadow", "live"] } },
  },
};

describe("a value the schema rejects", () => {
  test.each([
    [{ name: 3 }, "name must be string"],
    [{ ratio: "half" }, "ratio must be number"],
    [{ ratio: 1.5 }, "ratio must be 0..1"],
    [{ ratio: -0.1 }, "ratio must be 0..1"],
    [{ days: 2.5 }, "days must be integer"],
    [{ days: 0 }, "days must be 1..365"],
    [{ days: 366 }, "days must be 1..365"],
    [{ tags: "a" }, "tags must be array"],
    [{ tags: ["a", 2] }, "tags[1] must be string"],
    [{ modes: { rating: "on" } }, 'modes.rating must be one of "shadow", "live"'],
    [[], "the settings must be object"],
  ])("%j: %s", (value, problem) => {
    expect(settingsValueProblems(value, schema)).toEqual([problem]);
  });
});

describe("a value the schema accepts", () => {
  test.each([
    [{ name: "x", ratio: 0, days: 1, tags: [], modes: { rating: "live" } }],
    [{ ratio: 1, days: 365 }],
    [{ undeclared: 5 }],
  ])("%j", (value) => {
    expect(settingsValueProblems(value, schema)).toEqual([]);
  });
});

test("every problem is reported, not only the first", () => {
  expect(settingsValueProblems({ name: 1, days: 0 }, schema)).toEqual([
    "name must be string",
    "days must be 1..365",
  ]);
});
