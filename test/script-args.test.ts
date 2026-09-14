import { describe, expect, test } from "bun:test";
import { scriptArgs } from "../src/tools/lib/script-args";

describe("scriptArgs", () => {
  test("drops the runtime and the script path, keeping the rest in order", () => {
    expect(scriptArgs(["bun", "/tools/thread.ts", "--add", "--title", "x"])).toEqual([
      "--add",
      "--title",
      "x",
    ]);
  });

  test("a tool invoked with no arguments of its own gets an empty list", () => {
    expect(scriptArgs(["bun", "/tools/synthesize.ts"])).toEqual([]);
  });

  test("keeps an argument that looks like a path — only position decides", () => {
    expect(scriptArgs(["bun", "/tools/analyze.ts", "/tools/analyze.ts"])).toEqual([
      "/tools/analyze.ts",
    ]);
  });

  test("defaults to this process's own argv", () => {
    expect(scriptArgs()).toEqual(process.argv.slice(2));
  });
});
