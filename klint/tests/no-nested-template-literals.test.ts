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
    rules: { "no-nested-template-literals": "error" },
  });
  rmSync(root, { recursive: true });
  return violations;
}

describe("no-nested-template-literals", () => {
  test("flags a template literal directly inside a template span", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — string contains TS source code
    const v = lint("const x = `outer ${`inner`}`;");
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-nested-template-literals");
  });

  test("flags a template with interpolation inside a template span", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — string contains TS source code
    const v = lint("declare const n: number; const x = `a ${`b ${n}`}`;");
    expect(v).toHaveLength(1);
  });

  test("flags a template inside a ternary inside a template span", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — string contains TS source code
    const v = lint("declare const b: boolean; const x = `${b ? `yes` : `no`}`;");
    expect(v).toHaveLength(2);
  });

  test("flags a template passed as function argument inside a template span", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — string contains TS source code
    const v = lint("declare function f(s: string): string; const x = `${f(`inner`)}`;");
    expect(v).toHaveLength(1);
  });

  test("does not flag a standalone template literal", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — string contains TS source code
    const code = "declare const name: string; const x = `hello ${name}`;";
    expect(lint(code)).toHaveLength(0);
  });

  test("does not flag a tagged template inside a template span", () => {
    const code =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — string contains TS source code
      "declare function tag(s: TemplateStringsArray): string; const x = `${tag`inner`}`;";
    expect(lint(code)).toHaveLength(0);
  });
});
