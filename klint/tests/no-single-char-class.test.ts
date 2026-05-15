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
    rules: { "sonar/no-single-char-class": "error" },
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
    rules: { "sonar/no-single-char-class": "error" },
  });
  applyFixes(violations, root);
  const result = readFileSync(file, "utf-8");
  rmSync(root, { recursive: true });
  return result;
}

describe("sonar/no-single-char-class", () => {
  test("flags single literal char in class", () => {
    const v = lint(`const r = /a[b]c/;`);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("sonar/no-single-char-class");
  });

  test("flags single escape sequence in class", () => {
    const v = lint(`const r = /[\\d]+/;`);
    expect(v).toHaveLength(1);
  });

  test("does not flag multi-char class", () => {
    const v = lint(`const r = /[ab]/;`);
    expect(v).toHaveLength(0);
  });

  test("does not flag range class", () => {
    const v = lint(`const r = /[a-z]/;`);
    expect(v).toHaveLength(0);
  });

  test("does not flag negated class", () => {
    const v = lint(`const r = /[^a]/;`);
    expect(v).toHaveLength(0);
  });

  test("does not flag [.] — metachar exception avoids escaping", () => {
    const v = lint(`const r = /[.]{3}/;`);
    expect(v).toHaveLength(0);
  });

  test("does not flag [*] — metachar exception", () => {
    const v = lint(`const r = /[*]/;`);
    expect(v).toHaveLength(0);
  });

  test("does not flag [+] — metachar exception", () => {
    const v = lint(`const r = /[+]/;`);
    expect(v).toHaveLength(0);
  });

  test("does not flag [$] — metachar exception", () => {
    const v = lint(`const r = /[$]/;`);
    expect(v).toHaveLength(0);
  });

  test("fix removes brackets around single literal char", () => {
    const result = lintAndFix(`const r = /a[b]c/;\n`);
    expect(result).toBe(`const r = /abc/;\n`);
  });

  test("fix removes brackets around escape sequence", () => {
    // biome-ignore lint/style/useTemplate: String.raw tag + \n concatenation is clearer than nested interpolation
    const result = lintAndFix(String.raw`const r = /[\^]/;` + "\n");
    // biome-ignore lint/style/useTemplate: String.raw tag + \n concatenation is clearer than nested interpolation
    expect(result).toBe(String.raw`const r = /\^/;` + "\n");
  });

  test("fix handles multiple single-char classes in one regex", () => {
    const result = lintAndFix(`const r = /a[b]c[d]e/;\n`);
    expect(result).toBe(`const r = /abcde/;\n`);
  });

  test("fix preserves exception classes alongside flagged ones", () => {
    const result = lintAndFix(`const r = /a[b][.][c]/;\n`);
    expect(result).toBe(`const r = /ab[.]c/;\n`);
  });

  test("fix has populated fix field", () => {
    const v = lint(`const r = /a[b]c/;`);
    expect(v[0].fix).toBeDefined();
    expect(v[0].fix?.replacement).toContain("/abc/");
  });
});
