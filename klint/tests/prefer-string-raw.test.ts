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
    rules: { "sonar/prefer-string-raw": "error" },
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
    rules: { "sonar/prefer-string-raw": "error" },
  });
  applyFixes(violations, root);
  const result = readFileSync(file, "utf-8");
  rmSync(root, { recursive: true });
  return result;
}

describe("sonar/prefer-string-raw", () => {
  test("flags string literal with escaped backslash", () => {
    const v = lint(String.raw`const p = "C:\\Users\\Documents\\file.txt";`);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("sonar/prefer-string-raw");
  });

  test("does not flag string literal without escaped backslash", () => {
    const v = lint(`const s = "hello world";`);
    expect(v).toHaveLength(0);
  });

  test("does not flag string whose value contains a backtick (and has \\\\)", () => {
    // target: "foo\\bar`baz" — has \\ in source AND backtick in value
    const v = lint(`const s = "foo\\\\bar\`baz";`);
    expect(v).toHaveLength(0);
  });

  test("does not flag string whose value contains ${ (and has \\\\)", () => {
    // target: "C:\\Users${foo}" — has \\ in source AND ${ in value
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional source code string
    const v = lint('const s = "C:\\\\Users${foo}";');
    expect(v).toHaveLength(0);
  });

  test("does not flag string whose value ends with backslash", () => {
    // target: "trailing\\" — value ends with \ so String.raw template would be uncloseable
    const v = lint(String.raw`const s = "trailing\\";`);
    expect(v).toHaveLength(0);
  });

  test("fix rewrites single escaped backslash to String.raw", () => {
    // biome-ignore lint/style/useTemplate: String.raw tag + \n concatenation is clearer than nested interpolation
    const result = lintAndFix(String.raw`const p = "C:\\Users";` + "\n");
    expect(result).toBe("const p = String.raw`C:\\Users`;\n");
  });

  test("fix rewrites multiple escaped backslashes", () => {
    const result = lintAndFix(
      // biome-ignore lint/style/useTemplate: String.raw tag + \n concatenation is clearer than nested interpolation
      String.raw`const p = "C:\\Users\\Documents\\file.txt";` + "\n"
    );
    expect(result).toBe("const p = String.raw`C:\\Users\\Documents\\file.txt`;\n");
  });

  test("fix has populated fix field", () => {
    const v = lint(String.raw`const p = "C:\\Users";`);
    expect(v[0].fix).toBeDefined();
    expect(v[0].fix?.replacement).toContain("String.raw");
  });
});
