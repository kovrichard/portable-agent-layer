import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { testFilesOf } from "../.agents/scripts/test";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const REPO = resolve(import.meta.dir, "..");

function filesBunDiscovers(): string[] {
  const report = resolve(freshTestDir(import.meta.file), "discovered.xml");
  Bun.spawnSync(
    [
      "bun",
      "test",
      "--test-name-pattern",
      "^no test is named this$",
      "--reporter=junit",
      `--reporter-outfile=${report}`,
    ],
    { cwd: REPO, stdout: "ignore", stderr: "ignore" }
  );
  const files = Array.from(
    readFileSync(report, "utf-8").matchAll(/<testsuite [^>]*?file="([^"]+)"/g),
    (match) => match[1].replaceAll("\\", "/")
  );
  return [...new Set(files)].sort();
}

describe("bun run test --fast and --spawn", () => {
  test("together run every file bun test finds, and none twice", () => {
    const fast = testFilesOf(false, REPO);
    const spawn = testFilesOf(true, REPO);
    expect(fast.filter((file) => spawn.includes(file))).toEqual([]);
    expect([...fast, ...spawn].sort()).toEqual(filesBunDiscovers());
  });
});
