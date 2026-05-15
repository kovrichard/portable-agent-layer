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
    rules: { "sonar/prefer-string-replaceall": "error" },
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
    rules: { "sonar/prefer-string-replaceall": "error" },
  });
  applyFixes(violations, root);
  const result = readFileSync(file, "utf-8");
  rmSync(root, { recursive: true });
  return result;
}

describe("sonar/prefer-string-replaceall", () => {
  test("flags replace(/literal/g, x) with plain pattern", () => {
    const v = lint(`const r = "hello world".replace(/hello/g, "hi");`);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("sonar/prefer-string-replaceall");
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
    expect(v[0].rule).toBe("sonar/prefer-string-replaceall");
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

describe("severity", () => {
  test("warn — violation is emitted with severity warn", () => {
    const root = mkdtempSync(join(tmpdir(), "klint-test-"));
    writeFileSync(join(root, "subject.ts"), `s.replace(/x/g, "y");\n`);
    const violations = runKlint({
      root,
      include: ["."],
      rules: { "sonar/prefer-string-replaceall": "warn" as const },
    });
    rmSync(root, { recursive: true });
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("warn");
  });

  test("off — no violations emitted", () => {
    const root = mkdtempSync(join(tmpdir(), "klint-test-"));
    writeFileSync(join(root, "subject.ts"), `s.replace(/x/g, "y");\n`);
    const violations = runKlint({
      root,
      include: ["."],
      rules: { "sonar/prefer-string-replaceall": "off" as const },
    });
    rmSync(root, { recursive: true });
    expect(violations).toHaveLength(0);
  });
});

describe("chained fix", () => {
  test("two-pass: outer fix wins round 1, inner fixed in round 2", () => {
    // s.replace(/a/g, 'A').replace(/b/g, 'B') — both calls flagged.
    // Outer spans lines 1-2, inner spans line 1 only.
    // Pass 1: outer wins (larger range), inner skipped as overlapping.
    //   → s.replace(/a/g, 'A').replaceAll("b", 'B');  (collapsed to one line)
    // Pass 2: inner now stands alone on line 1, gets fixed.
    //   → s.replaceAll("a", 'A').replaceAll("b", 'B');
    const input = "s.replace(/a/g, 'A')\n  .replace(/b/g, 'B');\n";

    const root = mkdtempSync(join(tmpdir(), "klint-test-"));
    const file = join(root, "subject.ts");
    writeFileSync(file, input);

    const config = {
      root,
      include: ["."],
      rules: { "sonar/prefer-string-replaceall": "error" as const },
    };
    let current = runKlint(config);
    let totalApplied = 0;
    while (true) {
      const applied = applyFixes(current, root);
      totalApplied += applied;
      if (applied === 0) break;
      current = runKlint(config);
      if (current.every((v) => !v.fix)) break;
    }

    const result = readFileSync(file, "utf-8");
    rmSync(root, { recursive: true });

    expect(totalApplied).toBe(2);
    expect(result).toBe(`s.replaceAll("a", 'A').replaceAll("b", 'B');\n`);
  });
});
