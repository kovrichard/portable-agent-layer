import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKlint } from "../core/runner";

function lint(code: string) {
  const root = mkdtempSync(join(tmpdir(), "klint-test-"));
  writeFileSync(join(root, "subject.ts"), code);
  const violations = runKlint({
    root,
    include: ["."],
    rules: { "no-async-predicate": "error" },
  });
  rmSync(root, { recursive: true });
  return violations;
}

describe("no-async-predicate", () => {
  test("flags async callback on filter", () => {
    const v = lint(`
      declare function isValid(x: number): Promise<boolean>;
      const result = [1, 2, 3].filter(async (x) => await isValid(x));
    `);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-async-predicate");
    expect(v[0].message).toContain("filter");
  });

  test("flags async callback on some", () => {
    const v = lint(`
      declare function check(x: string): Promise<boolean>;
      ["a", "b"].some(async (x) => await check(x));
    `);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("some");
  });

  test("flags async callback on every", () => {
    const v = lint(`
      declare function valid(x: number): Promise<boolean>;
      [1, 2].every(async (x) => await valid(x));
    `);
    expect(v).toHaveLength(1);
  });

  test("flags async callback on find", () => {
    const v = lint(`
      declare function matches(x: string): Promise<boolean>;
      ["a", "b"].find(async (x) => await matches(x));
    `);
    expect(v).toHaveLength(1);
  });

  test("flags async callback on findIndex", () => {
    const v = lint(`
      declare function matches(x: number): Promise<boolean>;
      [1, 2, 3].findIndex(async (x) => await matches(x));
    `);
    expect(v).toHaveLength(1);
  });

  test("does not flag sync callback on filter", () => {
    const v = lint(`[1, 2, 3].filter((x) => x > 1);`);
    expect(v).toHaveLength(0);
  });

  test("does not flag async callback on map", () => {
    const v = lint(`
      declare function transform(x: number): Promise<string>;
      [1, 2, 3].map(async (x) => await transform(x));
    `);
    expect(v).toHaveLength(0);
  });

  test("does not flag async callback on forEach", () => {
    const v = lint(`
      declare function process(x: number): Promise<void>;
      [1, 2, 3].forEach(async (x) => { await process(x); });
    `);
    expect(v).toHaveLength(0);
  });
});
