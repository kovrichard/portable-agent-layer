import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFixes } from "../core/fixer";
import { runKlint } from "../core/runner";

function lint(code: string) {
  const root = mkdtempSync(join(tmpdir(), "klint-test-"));
  writeFileSync(join(root, "subject.ts"), code);
  const violations = runKlint({
    root,
    include: ["."],
    rules: { "sonar/prefer-at": "error" },
  });
  rmSync(root, { recursive: true });
  return violations;
}

function lintAndFix(code: string): string {
  const root = mkdtempSync(join(tmpdir(), "klint-test-"));
  const file = join(root, "subject.ts");
  writeFileSync(file, code);
  const violations = runKlint({
    root,
    include: ["."],
    rules: { "sonar/prefer-at": "error" },
  });
  applyFixes(violations, root);
  const result = readFileSync(file, "utf-8");
  rmSync(root, { recursive: true });
  return result;
}

describe("sonar/prefer-at", () => {
  test("flags arr[arr.length - 1]", () => {
    const v = lint(`const x = arr[arr.length - 1];`);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("sonar/prefer-at");
  });

  test("flags arr[arr.length - 5]", () => {
    const v = lint(`const x = arr[arr.length - 5];`);
    expect(v).toHaveLength(1);
  });

  test("flags property-access base obj.items[obj.items.length - 1]", () => {
    const v = lint(`const x = obj.items[obj.items.length - 1];`);
    expect(v).toHaveLength(1);
  });

  test("does not flag when base texts differ", () => {
    const v = lint(`const x = arr[other.length - 1];`);
    expect(v).toHaveLength(0);
  });

  test("does not flag arr[i] — arbitrary index", () => {
    const v = lint(`const x = arr[i];`);
    expect(v).toHaveLength(0);
  });

  test("does not flag arr[arr.length] — no subtraction", () => {
    const v = lint(`const x = arr[arr.length];`);
    expect(v).toHaveLength(0);
  });

  test("does not flag arr[arr.length - 0] — zero changes semantics", () => {
    const v = lint(`const x = arr[arr.length - 0];`);
    expect(v).toHaveLength(0);
  });

  test("does not flag arr[arr.length + 1] — addition not subtraction", () => {
    const v = lint(`const x = arr[arr.length + 1];`);
    expect(v).toHaveLength(0);
  });

  test("fix rewrites to .at(-1)", () => {
    const result = lintAndFix(`const x = arr[arr.length - 1];\n`);
    expect(result).toBe(`const x = arr.at(-1);\n`);
  });

  test("fix rewrites to .at(-5)", () => {
    const result = lintAndFix(`const x = arr[arr.length - 5];\n`);
    expect(result).toBe(`const x = arr.at(-5);\n`);
  });

  test("fix handles property-access base", () => {
    const result = lintAndFix(`const x = obj.items[obj.items.length - 1];\n`);
    expect(result).toBe(`const x = obj.items.at(-1);\n`);
  });

  test("fix has populated fix field", () => {
    const v = lint(`const x = arr[arr.length - 1];`);
    expect(v[0].fix).toBeDefined();
    expect(v[0].fix?.replacement).toContain(".at(-1)");
  });
});
