import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

test("criterion 8: package.json has the eval:planner-plan script", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  expect(pkg.scripts["eval:planner-plan"]).toBe("bun eval/run.ts planner-plan");
});
