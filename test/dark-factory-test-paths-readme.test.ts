import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const README = readFileSync(
  join(import.meta.dir, "../assets/plugins/dark-factory/README.md"),
  "utf8"
);

describe("the dark-factory README", () => {
  test("documents testPaths next to uiPaths", () => {
    const uiAt = README.indexOf("uiPaths");
    const testAt = README.indexOf("testPaths");
    expect(testAt).toBeGreaterThan(-1);
    expect(Math.abs(testAt - uiAt)).toBeLessThan(1500);
  });

  test("states the default rules for a test file", () => {
    const section = README.slice(README.indexOf("testPaths"));
    expect(section).toContain(".test.");
    expect(section).toContain(".spec.");
    expect(section).toContain("__tests__");
  });
});
