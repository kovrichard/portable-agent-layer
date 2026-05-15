import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFixes } from "../core/fixer";
import { runKlint } from "../core/runner";

function withRoot(code: string, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "klint-plugin-test-"));
  writeFileSync(join(root, "subject.ts"), code);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true });
  }
}

describe("plugin system", () => {
  test("sonar plugin applies its three rules at error severity", () => {
    // Each sonar rule fires on its canonical trigger
    withRoot(
      [
        `const a = s.replace(/x/g, "y");`,
        "const b = new RegExp(`\\\\\\\\d+`);",
        `if (!foo) foo = bar;`,
      ].join("\n"),
      (root) => {
        const violations = runKlint({
          root,
          include: ["."],
          plugins: ["sonar"],
          rules: {},
        });
        const rules = violations.map((v) => v.rule);
        expect(rules).toContain("sonar/prefer-string-replaceall");
        expect(rules).toContain("sonar/prefer-string-raw-regexp");
        expect(rules).toContain("sonar/prefer-nullish-coalescing-assign");
        expect(violations.every((v) => v.severity === "error")).toBe(true);
      }
    );
  });

  test("explicit rule entry overrides plugin default", () => {
    withRoot(`const a = s.replace(/x/g, "y");`, (root) => {
      const violations = runKlint({
        root,
        include: ["."],
        plugins: ["sonar"],
        rules: { "sonar/prefer-string-replaceall": "off" },
      });
      expect(
        violations.filter((v) => v.rule === "sonar/prefer-string-replaceall")
      ).toHaveLength(0);
    });
  });

  test("explicit warn overrides plugin error default", () => {
    withRoot(`const a = s.replace(/x/g, "y");`, (root) => {
      const violations = runKlint({
        root,
        include: ["."],
        plugins: ["sonar"],
        rules: { "sonar/prefer-string-replaceall": "warn" },
      });
      const v = violations.find((v) => v.rule === "sonar/prefer-string-replaceall");
      expect(v?.severity).toBe("warn");
    });
  });

  test("applyFixes resolves all three sonar violations in one pass", () => {
    const input = [
      `const a = s.replace(/x/g, "y");`,
      "const b = new RegExp(`\\\\\\\\d+`);",
      `if (!foo) foo = bar;`,
      "",
    ].join("\n");

    const root = mkdtempSync(join(tmpdir(), "klint-plugin-test-"));
    const file = join(root, "subject.ts");
    writeFileSync(file, input);

    const violations = runKlint({ root, include: ["."], plugins: ["sonar"], rules: {} });
    const applied = applyFixes(violations, root);
    const result = readFileSync(file, "utf-8");
    rmSync(root, { recursive: true });

    expect(applied).toBe(3);
    expect(result).toBe(
      [
        `const a = s.replaceAll("x", "y");`,
        "const b = new RegExp(String.raw`\\\\d+`);",
        `foo ??= bar;`,
        "",
      ].join("\n")
    );
  });

  test("unknown plugin name throws", () => {
    withRoot("", (root) => {
      expect(() =>
        runKlint({ root, include: ["."], plugins: ["nonexistent"], rules: {} })
      ).toThrow('Unknown klint plugin: "nonexistent"');
    });
  });
});
