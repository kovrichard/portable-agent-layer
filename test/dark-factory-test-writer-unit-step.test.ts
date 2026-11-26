import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT } from "../assets/plugins/dark-factory/scripts/lib.mjs";

const prompt = () => readFileSync(join(PLUGIN_ROOT, "agents/test-writer.md"), "utf8");

describe("the test writer's plan.md rule", () => {
  test("the unit-test step may read plan.md's example tables", () => {
    expect(prompt()).toContain(
      "When your instructions ask for unit tests from plan.md's example tables, read plan.md"
    );
  });

  test("the acceptance tests still come from spec.md alone", () => {
    expect(prompt()).toContain(
      "Never read plan.md for acceptance tests; they come from spec.md alone."
    );
  });
});
