import { describe, expect, test } from "bun:test";
import { testsObserving } from "../.agents/scripts/observing-tests";

const graph = {
  "test/setup.ts": ["test/lib/home.ts"],
  "test/lib/home.ts": [],
  "test/a.test.ts": ["src/a.ts"],
  "test/b.test.ts": ["src/b.ts"],
  "test/c.test.ts": ["test/lib/helper.ts"],
  "test/lib/helper.ts": ["src/b.ts"],
  "src/a.ts": ["src/shared.ts"],
  "src/b.ts": [],
  "src/shared.ts": [],
};
const TESTS = ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"];

describe("the tests that can observe a mutant", () => {
  test("a test importing the file directly", () => {
    expect(testsObserving(["src/a.ts"], TESTS, graph)).toEqual(["test/a.test.ts"]);
  });

  test("a test reaching it through other modules, its helpers included", () => {
    expect(testsObserving(["src/shared.ts"], TESTS, graph)).toEqual(["test/a.test.ts"]);
    expect(testsObserving(["src/b.ts"], TESTS, graph)).toEqual([
      "test/b.test.ts",
      "test/c.test.ts",
    ]);
  });

  test("several mutated files take every test any of them reaches", () => {
    expect(testsObserving(["src/a.ts", "src/b.ts"], TESTS, graph)).toEqual(TESTS);
  });

  test("a file the preload imports is seen by every test", () => {
    expect(testsObserving(["test/lib/home.ts"], TESTS, graph)).toEqual(TESTS);
  });

  test("a file no test imports leaves none", () => {
    expect(testsObserving(["src/unused.ts"], TESTS, graph)).toEqual([]);
  });

  test("an import cycle ends", () => {
    const cyclic = { ...graph, "src/b.ts": ["src/c.ts"], "src/c.ts": ["src/b.ts"] };
    expect(testsObserving(["src/c.ts"], TESTS, cyclic)).toEqual([
      "test/b.test.ts",
      "test/c.test.ts",
    ]);
  });
});
