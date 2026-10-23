import { describe, expect, test } from "bun:test";
import { slowestTests } from "../.agents/scripts/test";

function testcase(name: string, time: string, file = "test/a.test.ts"): string {
  return `<testcase name="${name}" classname="suite" time="${time}" file="${file}" line="1" />`;
}

describe("the slowest tests a CI run prints", () => {
  test("lists the slowest first, at most the count asked for", () => {
    const junit = [
      testcase("quick", "0.01"),
      testcase("slowest", "19.5"),
      testcase("slow", "4.2"),
    ].join("\n");

    expect(slowestTests(junit, 2)).toEqual([
      "  19.50s  test/a.test.ts > suite > slowest",
      "   4.20s  test/a.test.ts > suite > slow",
    ]);
  });

  test("shows names as written and Windows paths with forward slashes", () => {
    const junit = testcase("PAL&apos;s &quot;init&quot;", "1", "test\\cli.spawn.test.ts");

    expect(slowestTests(junit, 1)).toEqual([
      `   1.00s  test/cli.spawn.test.ts > suite > PAL's "init"`,
    ]);
  });
});
