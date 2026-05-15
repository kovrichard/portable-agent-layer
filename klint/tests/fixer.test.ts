import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFixes } from "../core/fixer";
import type { Violation } from "../core/types";

function withFile(content: string, fn: (path: string, root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "fixer-test-"));
  const file = join(root, "subject.ts");
  writeFileSync(file, content);
  fn(file, root);
  const result = readFileSync(file, "utf-8");
  rmSync(root, { recursive: true });
  return result;
}

function v(
  file: string,
  startLine: number,
  endLine: number,
  replacement: string
): Violation {
  return {
    file,
    line: startLine,
    rule: "test",
    message: "test",
    severity: "error",
    fix: { startLine, endLine, replacement },
  };
}

describe("applyFixes", () => {
  test("applies a single fix", () => {
    const result = withFile("const x = 1;\n", (_, root) => {
      applyFixes([v("subject.ts", 1, 1, "const x = 2;")], root);
    });
    expect(result).toBe("const x = 2;\n");
  });

  test("applies non-overlapping fixes bottom-to-top", () => {
    const result = withFile("line1\nline2\nline3\n", (_, root) => {
      applyFixes(
        [v("subject.ts", 1, 1, "FIXED1"), v("subject.ts", 3, 3, "FIXED3")],
        root
      );
    });
    expect(result).toBe("FIXED1\nline2\nFIXED3\n");
  });

  test("when two fixes share the same startLine, applies the largest range and skips the smaller", () => {
    // Simulates chained .replace() — both violations start at line 1 but
    // the outer call spans lines 1-2 while the inner only spans line 1.
    const result = withFile(
      "s.replace(/a/g, 'A')\n  .replace(/b/g, 'B');\n",
      (_, root) => {
        applyFixes(
          [
            // inner: startLine=1, endLine=1 → smaller range
            v("subject.ts", 1, 1, "s.replaceAll('a', 'A')"),
            // outer: startLine=1, endLine=2 → larger range applied first
            v("subject.ts", 1, 2, "s.replace(/a/g, 'A')\n  .replaceAll('b', 'B');"),
          ],
          root
        );
      }
    );
    // Outer fix applied, inner skipped — result has the outer replacement
    expect(result).toBe("s.replace(/a/g, 'A')\n  .replaceAll('b', 'B');\n");
  });

  test("does not apply a fix whose range overlaps an already-applied fix", () => {
    const result = withFile("line1\nline2\nline3\n", (_, root) => {
      applyFixes(
        [
          v("subject.ts", 1, 3, "OUTER"),
          v("subject.ts", 2, 2, "INNER"), // contained within 1-3, should be skipped
        ],
        root
      );
    });
    expect(result).toBe("OUTER\n");
  });

  test("applies fixes on adjacent but non-overlapping lines correctly", () => {
    const result = withFile("a\nb\nc\nd\n", (_, root) => {
      applyFixes([v("subject.ts", 1, 2, "AB"), v("subject.ts", 3, 4, "CD")], root);
    });
    expect(result).toBe("AB\nCD\n");
  });
});
