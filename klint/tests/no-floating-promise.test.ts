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
    rules: { "no-floating-promise": "error" },
  });
  rmSync(root, { recursive: true });
  return violations;
}

describe("no-floating-promise", () => {
  test("flags a bare async call statement", () => {
    const v = lint(`
      async function fetch(): Promise<string> { return "x"; }
      fetch();
    `);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("no-floating-promise");
  });

  test("flags a union return type (Promise<T> | undefined)", () => {
    const v = lint(`
      function maybe(): Promise<number> | undefined { return Promise.resolve(1); }
      maybe();
    `);
    expect(v).toHaveLength(1);
  });

  test("does not flag an awaited call", () => {
    const v = lint(`
      async function fetch(): Promise<string> { return "x"; }
      async function main() { await fetch(); }
    `);
    expect(v).toHaveLength(0);
  });

  test("does not flag a .catch() chain", () => {
    const v = lint(`
      async function fetch(): Promise<string> { return "x"; }
      fetch().catch(console.error);
    `);
    expect(v).toHaveLength(0);
  });

  test("does not flag a .finally() chain", () => {
    const v = lint(`
      async function fetch(): Promise<string> { return "x"; }
      fetch().finally(() => {});
    `);
    expect(v).toHaveLength(0);
  });

  test("does not flag a void expression", () => {
    const v = lint(`
      async function fetch(): Promise<string> { return "x"; }
      void fetch();
    `);
    expect(v).toHaveLength(0);
  });

  test("does not flag a sync call returning a non-Promise", () => {
    const v = lint(`
      function greet(): string { return "hello"; }
      greet();
    `);
    expect(v).toHaveLength(0);
  });
});
