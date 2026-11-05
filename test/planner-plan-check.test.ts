import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const EVAL = resolve(import.meta.dir, "../eval/planner-plan");
const check = require(resolve(EVAL, "check.js"));
const prompt = require(resolve(EVAL, "prompt.js"));

const HEADINGS = `## Criteria map
1. Literal: any added name. Steps: 2.

## Must not add
- no new events

## Runtime model
`;

const namedPlan = `${HEADINGS}Two overlapping coach runs read-modify-write findings.jsonl, so hold a lock around the whole update.
`;
const unnamedPlan = `${HEADINGS}Step 1: add the helper. Step 2: add the tests.
`;
const controlPlan = `${HEADINGS}No shared state and no per-call work.
`;
const inventedControlPlan = `${controlPlan}Add a lockfile around the rename.
`;

const hazardPatterns = [
  "(lock|atomic|rename|concurren|overlap|race|two runs)[^\\n]{0,200}findings",
  "findings[^\\n]{0,200}(lock|atomic|concurren|overlap|race|two runs)",
];

describe("hazard", () => {
  test("passes a plan that names the hazard", () => {
    expect(check.hazard(namedPlan, { vars: { hazard: hazardPatterns } }).pass).toBe(true);
  });

  test("fails a plan that does not name the hazard", () => {
    expect(check.hazard(unnamedPlan, { vars: { hazard: hazardPatterns } }).pass).toBe(
      false
    );
  });

  test("returns true when the case is the control", () => {
    expect(check.hazard(unnamedPlan, { vars: { control: true } })).toBe(true);
  });
});

describe("sections", () => {
  test("passes a plan with all three sections", () => {
    expect(check.sections(namedPlan).pass).toBe(true);
  });

  test("fails a plan missing the runtime model section", () => {
    const plan = namedPlan.replace("## Runtime model\n", "");
    expect(check.sections(plan).pass).toBe(false);
  });
});

describe("control", () => {
  test("passes a plan with no invented work", () => {
    expect(check.control(controlPlan, { vars: { control: true } }).pass).toBe(true);
  });

  test("fails a plan that adds a lock", () => {
    expect(check.control(inventedControlPlan, { vars: { control: true } }).pass).toBe(
      false
    );
  });

  test("returns true when the case is not the control", () => {
    expect(check.control(inventedControlPlan, { vars: { control: false } })).toBe(true);
  });
});

describe("prompt", () => {
  test("builds current and baseline from the spec and the excerpt", () => {
    const context = { vars: { spec: "SPEC-X", code: "CODE-Y" } };
    const baselineBody = readFileSync(
      resolve(EVAL, "baseline-planner.md"),
      "utf8"
    ).trim();
    for (const text of [prompt.current(context), prompt.baseline(context)]) {
      expect(text).toContain("SPEC-X");
      expect(text).toContain("CODE-Y");
    }
    expect(prompt.baseline(context).startsWith(baselineBody)).toBe(true);
  });
});
