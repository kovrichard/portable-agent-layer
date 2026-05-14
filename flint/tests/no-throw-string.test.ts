import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFlint } from "../core/runner";

function lint(code: string) {
  const root = mkdtempSync(join(tmpdir(), "flint-test-"));
  writeFileSync(join(root, "subject.ts"), code);
  const violations = runFlint({ root, include: ["."], rules: ["no-throw-string"] });
  rmSync(root, { recursive: true });
  return violations;
}

describe("no-throw-string", () => {
  test("flags a thrown string literal", () => {
    const v = lint(`throw "something went wrong";`);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-throw-string");
  });

  test("flags a thrown template literal", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — string contains TS source code
    const v = lint("const msg = 'x'; throw `error: ${msg}`;");
    expect(v).toHaveLength(1);
  });

  test("flags a thrown no-substitution template literal", () => {
    const v = lint("throw `plain message`;");
    expect(v).toHaveLength(1);
  });

  test("does not flag throw new Error", () => {
    const v = lint(`throw new Error("something went wrong");`);
    expect(v).toHaveLength(0);
  });

  test("does not flag throw of a variable", () => {
    const v = lint(`
      const err = new Error("oops");
      throw err;
    `);
    expect(v).toHaveLength(0);
  });

  test("does not flag throw of a custom Error subclass", () => {
    const v = lint(`
      class AppError extends Error {}
      throw new AppError("oops");
    `);
    expect(v).toHaveLength(0);
  });
});
