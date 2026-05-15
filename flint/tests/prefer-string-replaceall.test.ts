import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFixes } from "../core/fixer";
import { runFlint } from "../core/runner";

function lint(code: string) {
  const root = mkdtempSync(join(tmpdir(), "flint-test-"));
  writeFileSync(join(root, "subject.ts"), code);
  const violations = runFlint({
    root,
    include: ["."],
    rules: ["prefer-string-replaceall"],
  });
  rmSync(root, { recursive: true });
  return violations;
}

function lintAndFix(code: string): string {
  const root = mkdtempSync(join(tmpdir(), "flint-test-"));
  const file = join(root, "subject.ts");
  writeFileSync(file, code);
  const violations = runFlint({
    root,
    include: ["."],
    rules: ["prefer-string-replaceall"],
  });
  applyFixes(violations, root);
  const result = readFileSync(file, "utf-8");
  rmSync(root, { recursive: true });
  return result;
}

describe("prefer-string-replaceall", () => {
  test("flags replace(/literal/g, x) with plain pattern", () => {
    const v = lint(`const r = "hello world".replace(/hello/g, "hi");`);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("prefer-string-replaceall");
  });

  test("flags replace(/literal/g, x) with multi-word pattern", () => {
    const v = lint(`const r = "foo bar baz".replace(/foo bar/g, "x");`);
    expect(v).toHaveLength(1);
  });

  test("does not flag when regex has additional flag i", () => {
    const v = lint(`const r = "foo foo".replace(/foo/gi, "bar");`);
    expect(v).toHaveLength(0);
  });

  test("does not flag when regex has flag m", () => {
    const v = lint(`const r = "foo".replace(/foo/gm, "bar");`);
    expect(v).toHaveLength(0);
  });

  test("does not flag when regex has no g flag", () => {
    const v = lint(`const r = "foo".replace(/foo/, "bar");`);
    expect(v).toHaveLength(0);
  });

  test("does not flag when pattern has dot metachar", () => {
    const v = lint(`const r = "foo.bar".replace(/./g, "");`);
    expect(v).toHaveLength(0);
  });

  test("does not flag when pattern has character class", () => {
    const v = lint(`const r = "a b".replace(/[{}\\s]/g, "");`);
    expect(v).toHaveLength(0);
  });

  test("does not flag when pattern has quantifier", () => {
    const v = lint(`const r = "a  b".replace(/\\s+/g, " ");`);
    expect(v).toHaveLength(0);
  });

  test("does not flag when pattern has capturing group", () => {
    const v = lint(`const r = "a:b".replace(/(\\w+):(\\w+)/g, "$2:$1");`);
    expect(v).toHaveLength(0);
  });

  test("does not flag when pattern has backslash escape", () => {
    const v = lint(`const r = "a.b".replace(/\\./g, "-");`);
    expect(v).toHaveLength(0);
  });

  test("flags replace(/\\\\/g, x) — escaped backslash is a plain literal", () => {
    const v = lint(`const r = path.replace(/\\\\/g, "/");`);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("prefer-string-replaceall");
  });

  test('fix rewrites replace(/\\\\/g, x) to replaceAll("x\\\\\\\\", x)', () => {
    const result = lintAndFix(`const r = path.replace(/\\\\/g, "/");\n`);
    expect(result).toBe(`const r = path.replaceAll("\\\\", "/");\n`);
  });

  test("fix rewrites replace(/literal/g, x) to replaceAll(literal, x)", () => {
    const result = lintAndFix(`const r = "hello world".replace(/hello/g, "hi");\n`);
    expect(result).toBe(`const r = "hello world".replaceAll("hello", "hi");\n`);
  });

  test("fix preserves replacement expression", () => {
    const result = lintAndFix(
      `declare const repl: string;\nconst r = text.replace(/foo/g, repl);\n`
    );
    expect(result).toContain(`replaceAll("foo", repl)`);
  });

  test("fix has populated fix field", () => {
    const v = lint(`const r = "hello".replace(/hello/g, "hi");`);
    expect(v[0].fix).toBeDefined();
    expect(v[0].fix?.replacement).toContain("replaceAll");
  });
});
