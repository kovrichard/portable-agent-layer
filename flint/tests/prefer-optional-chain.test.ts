import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFlint } from "../core/runner";

function lint(code: string) {
  const root = mkdtempSync(join(tmpdir(), "flint-test-"));
  writeFileSync(join(root, "subject.ts"), code);
  const violations = runFlint({ root, include: ["."], rules: ["prefer-optional-chain"] });
  rmSync(root, { recursive: true });
  return violations;
}

describe("prefer-optional-chain", () => {
  test("flags identifier && identifier.prop", () => {
    const v = lint(
      `declare const user: { name: string } | null; const x = user && user.name;`
    );
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("prefer-optional-chain");
    expect(v[0].message).toContain("user?.name");
  });

  test("flags property access && same.deeper", () => {
    const v = lint(`
      declare const obj: { a: { b: string } | null } | null;
      const x = obj.a && obj.a.b;
    `);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("obj.a?.b");
  });

  test("flags guard && method call", () => {
    const v = lint(`declare const fn: { run: () => void } | null; fn && fn.run();`);
    expect(v).toHaveLength(1);
  });

  test("flags guard && bracket access", () => {
    const v = lint(`declare const arr: string[] | null; const x = arr && arr[0];`);
    expect(v).toHaveLength(1);
  });

  test("does not flag unrelated operands", () => {
    const v = lint(
      `declare const a: boolean; declare const b: string; const x = a && b;`
    );
    expect(v).toHaveLength(0);
  });

  test("does not flag already-optional chain", () => {
    const v = lint(`declare const user: { name: string } | null; const x = user?.name;`);
    expect(v).toHaveLength(0);
  });

  test("flags && guard in if condition", () => {
    const v = lint(`
      declare const user: { name: string } | null;
      if (user && user.name) { console.log("ok"); }
    `);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("user?.name");
  });

  test("flags && guard in while condition", () => {
    const v = lint(`
      declare let node: { next: unknown } | null;
      while (node && node.next) { node = null; }
    `);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("node?.next");
  });

  test("does not flag prefix-substring false positive", () => {
    const v = lint(
      `declare const foo: boolean; declare const fooBar: { x: string }; const r = foo && fooBar.x;`
    );
    expect(v).toHaveLength(0);
  });
});
