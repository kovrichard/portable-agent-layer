import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFlint } from "../core/runner";

function lint(code: string) {
  const root = mkdtempSync(join(tmpdir(), "flint-test-"));
  writeFileSync(join(root, "subject.ts"), code);
  const violations = runFlint({ root, include: ["."], rules: ["no-string-match"] });
  rmSync(root, { recursive: true });
  return violations;
}

describe("no-string-match", () => {
  test("flags .match() with a non-global regex literal", () => {
    const v = lint("const m = line.match(/^-\\s+(\\d+):/i);");
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-string-match");
  });

  test("flags .match() with a regex literal with no flags", () => {
    const v = lint("const m = line.match(/foo/);");
    expect(v).toHaveLength(1);
  });

  test("does not flag .match() with a global regex literal", () => {
    const v = lint("const m = line.match(/foo/g);");
    expect(v).toHaveLength(0);
  });

  test("does not flag .match() with a global+flag regex", () => {
    const v = lint("const m = line.match(/foo/gi);");
    expect(v).toHaveLength(0);
  });

  test("does not flag .match() with a variable argument", () => {
    const v = lint("declare const re: RegExp; const m = line.match(re);");
    expect(v).toHaveLength(0);
  });
});
