import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "../assets/plugins/dark-factory");
const read = (path: string) => readFileSync(join(PLUGIN, path), "utf8");
const HEADING = "## Test files this task changes";

describe("the docs for the spec's test-file exemption", () => {
  test("the PO skill names the section", () => {
    const text = read("skills/po/SKILL.md");
    expect(text).toContain(HEADING);
    expect(text).toMatch(/only when[^.]*test/i);
  });

  test("the README describes the section and the guarded fix ladders", () => {
    const text = read("README.md");
    expect(text).toContain(HEADING);
    expect(text).toMatch(/review[^.]*tester[^.]*CI|review, tester/i);
  });

  test("build-with-agents snapshots before and checks test-edits after the review, tester and CI fixes", () => {
    const text = read("skills/build-with-agents/SKILL.md");
    const pipeline = text.slice(text.indexOf("### 3. After the code"));
    const steps = pipeline.slice(0, pipeline.indexOf("## Stopping"));
    expect(steps.split("step.mjs snapshot").length - 1).toBeGreaterThanOrEqual(1);
    expect(steps.split("step.mjs test-edits").length - 1).toBeGreaterThanOrEqual(1);
    expect(steps).toMatch(/review/i);
    expect(steps).toMatch(/tester/i);
    expect(steps).toMatch(/CI/);
  });
});
