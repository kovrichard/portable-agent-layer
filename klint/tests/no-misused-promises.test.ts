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
    rules: { "no-misused-promises": "error" },
  });
  rmSync(root, { recursive: true });
  return violations;
}

describe("no-misused-promises", () => {
  test("flags async callback passed to forEach", () => {
    const v = lint(`
      declare function process(x: number): Promise<void>;
      [1, 2, 3].forEach(async (item) => { await process(item); });
    `);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-misused-promises");
  });

  test("flags async callback passed to filter", () => {
    const v = lint(`
      declare function isValid(x: number): Promise<boolean>;
      [1, 2, 3].filter(async (item) => await isValid(item));
    `);
    expect(v).toHaveLength(1);
  });

  test("flags async comparator passed to sort", () => {
    const v = lint(`
      declare function compare(a: number, b: number): Promise<number>;
      [1, 2, 3].sort(async (a, b) => await compare(a, b));
    `);
    expect(v).toHaveLength(1);
  });

  test("does not flag async callback passed to map", () => {
    const v = lint(`
      declare function transform(x: number): Promise<string>;
      [1, 2, 3].map(async (item) => await transform(item));
    `);
    expect(v).toHaveLength(0);
  });

  test("does not flag async callback passed to Promise.then", () => {
    const v = lint(`
      declare function fetch(): Promise<string>;
      fetch().then(async (value) => value.toUpperCase());
    `);
    expect(v).toHaveLength(0);
  });

  test("does not flag sync callback passed to forEach", () => {
    const v = lint(`
      [1, 2, 3].forEach((item) => console.log(item));
    `);
    expect(v).toHaveLength(0);
  });
});
