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
    rules: { "sonar/prefer-string-raw-regexp": "error" },
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
    rules: { "sonar/prefer-string-raw-regexp": "error" },
  });
  applyFixes(violations, root);
  const result = readFileSync(file, "utf-8");
  rmSync(root, { recursive: true });
  return result;
}

describe("sonar/prefer-string-raw-regexp", () => {
  test("flags new RegExp(template) with double backslash in no-substitution literal", () => {
    const v = lint("const r = new RegExp(`\\\\.foo`);");
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("sonar/prefer-string-raw-regexp");
  });

  test("flags new RegExp(template) with double backslash in template expression", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional source code string
    const v = lint("declare const n: string; const r = new RegExp(`\\\\.(${n})`);");
    expect(v).toHaveLength(1);
  });

  test("does not flag new RegExp(template) without double backslash", () => {
    const v = lint("const r = new RegExp(`foo.bar`);");
    expect(v).toHaveLength(0);
  });

  test("does not flag new RegExp(regexLiteral)", () => {
    const v = lint("const r = new RegExp(/foo/);");
    expect(v).toHaveLength(0);
  });

  test("does not flag new RegExp(variable)", () => {
    const v = lint("declare const p: string; const r = new RegExp(p);");
    expect(v).toHaveLength(0);
  });

  test("does not flag new RegExp(String.raw template) already using String.raw", () => {
    const v = lint("const r = new RegExp(String.raw`\\.foo`);");
    expect(v).toHaveLength(0);
  });

  test("fix rewrites no-substitution template to String.raw", () => {
    const result = lintAndFix("const r = new RegExp(`\\\\.foo`);\n");
    expect(result).toBe("const r = new RegExp(String.raw`\\.foo`);\n");
  });

  test("fix rewrites template expression to String.raw", () => {
    const result = lintAndFix(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional source code string
      "declare const n: string;\nconst r = new RegExp(`\\\\.(${n})`);\n"
    );
    expect(result).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional source code string
      "declare const n: string;\nconst r = new RegExp(String.raw`\\.(${n})`);\n"
    );
  });

  test("fix handles multi-escape template correctly", () => {
    const result = lintAndFix("const r = new RegExp(`\\\\.(?:foo)[/\\\\\\\\]\\\\S*`);\n");
    expect(result).toBe("const r = new RegExp(String.raw`\\.(?:foo)[/\\\\]\\S*`);\n");
  });

  test("fix has populated fix field", () => {
    const v = lint("const r = new RegExp(`\\\\.foo`);");
    expect(v[0].fix).toBeDefined();
    expect(v[0].fix?.replacement).toContain("String.raw");
  });
});
