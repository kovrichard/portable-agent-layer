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
    rules: { "no-string-match": "error" },
  });
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

  test("fix rewrites str.match(/re/) to new RegExp(/re/).exec(str)", () => {
    const root = mkdtempSync(join(tmpdir(), "klint-test-"));
    const file = join(root, "subject.ts");
    writeFileSync(file, "declare const line: string;\nconst m = line.match(/foo/);\n");
    const violations = runKlint({
      root,
      include: ["."],
      rules: { "no-string-match": "error" },
    });
    applyFixes(violations, root);
    const result = readFileSync(file, "utf-8");
    rmSync(root, { recursive: true });
    expect(result).toBe(
      "declare const line: string;\nconst m = new RegExp(/foo/).exec(line);\n"
    );
  });

  test("fix has populated fix field", () => {
    const v = lint("declare const line: string; const m = line.match(/foo/i);");
    expect(v[0].fix).toBeDefined();
    expect(v[0].fix?.replacement).toContain("new RegExp(/foo/i).exec(line)");
  });
});
