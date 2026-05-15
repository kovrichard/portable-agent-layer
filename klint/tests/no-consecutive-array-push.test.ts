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
    rules: { "no-consecutive-array-push": "error" },
  });
  rmSync(root, { recursive: true });
  return violations;
}

describe("no-consecutive-array-push", () => {
  test("flags two consecutive pushes on same array", () => {
    const v = lint(`const arr: number[] = []; arr.push(1); arr.push(2);`);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-consecutive-array-push");
    expect(v[0].message).toContain("arr");
  });

  test("flags three consecutive pushes", () => {
    const v = lint(
      `const arr: string[] = []; arr.push("a"); arr.push("b"); arr.push("c");`
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("3 consecutive");
  });

  test("does not flag a single push", () => {
    const v = lint(`const arr: number[] = []; arr.push(1);`);
    expect(v).toHaveLength(0);
  });

  test("does not flag pushes on different arrays", () => {
    const v = lint(
      `const a: number[] = []; const b: number[] = []; a.push(1); b.push(2);`
    );
    expect(v).toHaveLength(0);
  });

  test("does not flag pushes separated by another statement", () => {
    const v = lint(
      `const arr: number[] = []; arr.push(1); console.log("x"); arr.push(2);`
    );
    expect(v).toHaveLength(0);
  });
});
