import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const stripFrontmatter = (text: string) => text.replace(/^---[\s\S]*?---\n/, "").trim();

test("criterion 5: baseline-planner.md is the canary planner.md minus its frontmatter", () => {
  const shown = Bun.spawnSync(
    ["git", "show", "origin/canary:assets/plugins/dark-factory/agents/planner.md"],
    { cwd: ROOT }
  );
  expect(shown.exitCode).toBe(0);
  const baseline = readFileSync(
    resolve(ROOT, "eval/planner-plan/baseline-planner.md"),
    "utf8"
  );
  expect(baseline.trim()).toBe(stripFrontmatter(shown.stdout.toString()));
});

test("criterion 8: package.json has the eval:planner-plan script", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  expect(pkg.scripts["eval:planner-plan"]).toBe("bun eval/run.ts planner-plan");
});
