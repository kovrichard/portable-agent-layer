import { describe, expect, test } from "bun:test";
import { slowestTests } from "../.agents/scripts/test";

function testcase(name: string, time: string, file = "test/a.test.ts"): string {
  return `<testcase name="${name}" classname="suite" time="${time}" file="${file}" line="1" />`;
}

describe("the slowest tests a run prints", () => {
  test("lists the slowest first, at most the count asked for", () => {
    const junit = [
      testcase("quick", "0.01"),
      testcase("slowest", "19.5"),
      testcase("slow", "4.2"),
    ].join("\n");

    expect(slowestTests(junit, 2, false)).toEqual([
      "  19.50s  test/a.test.ts > suite > slowest",
      "   4.20s  test/a.test.ts > suite > slow",
    ]);
  });

  test("ranks fast and spawn tests apart", () => {
    const junit = [
      testcase("fast one", "0.3"),
      testcase("spawn one", "9", "test/cli.spawn.test.ts"),
    ].join("\n");

    expect(slowestTests(junit, 10, false)).toEqual([
      "   0.30s  test/a.test.ts > suite > fast one",
    ]);
    expect(slowestTests(junit, 10, true)).toEqual([
      "   9.00s  test/cli.spawn.test.ts > suite > spawn one",
    ]);
  });

  test("shows names as written and Windows paths with forward slashes", () => {
    const junit = testcase("PAL&apos;s &quot;init&quot;", "1", "test\\cli.spawn.test.ts");

    expect(slowestTests(junit, 1, true)).toEqual([
      `   1.00s  test/cli.spawn.test.ts > suite > PAL's "init"`,
    ]);
  });
});
