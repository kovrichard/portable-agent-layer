import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFlint } from "../core/runner";

function lint(code: string) {
  const root = mkdtempSync(join(tmpdir(), "flint-test-"));
  writeFileSync(join(root, "subject.ts"), code);
  const violations = runFlint({ root, include: ["."], rules: ["no-nested-ternary"] });
  rmSync(root, { recursive: true });
  return violations;
}

describe("no-nested-ternary", () => {
  test("flags ternary nested in then-branch", () => {
    const v = lint(
      `declare const a: boolean, b: boolean; const x = a ? (b ? 1 : 2) : 3;`
    );
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-nested-ternary");
  });

  test("flags ternary nested in else-branch", () => {
    const v = lint(`declare const a: boolean, b: boolean; const x = a ? 1 : b ? 2 : 3;`);
    expect(v).toHaveLength(1);
  });

  test("flags both when doubly nested", () => {
    const v = lint(
      `declare const a: boolean, b: boolean, c: boolean; const x = a ? b ? 1 : 2 : c ? 3 : 4;`
    );
    expect(v).toHaveLength(1);
  });

  test("does not flag a simple ternary", () => {
    const v = lint(`declare const a: boolean; const x = a ? 1 : 2;`);
    expect(v).toHaveLength(0);
  });

  test("does not flag ternary whose branches are not ternaries", () => {
    const v = lint(`declare const a: boolean; const x = a ? "yes" : "no";`);
    expect(v).toHaveLength(0);
  });
});
