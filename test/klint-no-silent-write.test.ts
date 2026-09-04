import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { RawViolation } from "@konvert7/klint/core/types";
import rules from "../klint.rules";

// The rule this covers shipped once as a file-level check, and a silent writer
// went out under it: an ungated emit.data() anywhere in the file excused every
// other branch. The cases below pin the per-function judgement that replaced it.

let ROOT: string;

function toolFile(name: string, source: string): string {
  const dir = resolve(ROOT, "src/tools");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, name);
  writeFileSync(file, source, "utf-8");
  return file;
}

function check(files: string[]): RawViolation[] {
  const violations: RawViolation[] = [];
  rules["no-silent-write"].check({ files, root: ROOT } as never, violations);
  return violations;
}

beforeEach(() => {
  ROOT = mkdtempSync(resolve(tmpdir(), "pal-klint-"));
});

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const SILENT = `import { writeFileSync } from "node:fs";
import { emit } from "./lib/emit";

export function save(path: string): void {
  writeFileSync(path, "x", "utf-8");
}

function run() {
  save("/tmp/x");
  emit.ok("Saved");
}
`;

describe("no-silent-write", () => {
  test("flags a function that confirms a write through emit.ok", () => {
    const file = toolFile("silent.ts", SILENT);
    const found = check([file]);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("run()");
  });

  test("points at the emit.ok line, not the top of the file", () => {
    const file = toolFile("silent.ts", SILENT);
    expect(check([file])[0].line).toBe(10);
  });

  test("still flags when another function prints ungated output", () => {
    // The exact shape that defeated the file-level rule: emit.data() on an
    // unrelated branch used to excuse the whole file.
    const file = toolFile(
      "mixed.ts",
      SILENT.replace(
        "function run() {",
        `function list() {
  emit.data("[]");
}

function run() {`
      )
    );
    expect(check([file])).toHaveLength(1);
  });

  test("accepts a function that emits a receipt alongside its progress lines", () => {
    const file = toolFile(
      "loud.ts",
      SILENT.replace(
        'emit.ok("Saved");',
        'emit.ok("Saved");\n  emit.receipt("/tmp/x", { bytes: 1 });'
      )
    );
    expect(check([file])).toHaveLength(0);
  });

  test("ignores a file that never writes to disk", () => {
    const file = toolFile(
      "reader.ts",
      `import { emit } from "./lib/emit";

function run() {
  emit.ok("Loaded");
}
`
    );
    expect(check([file])).toHaveLength(0);
  });

  test("ignores emit.ts itself, which defines the convention", () => {
    const dir = resolve(ROOT, "src/tools/lib");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, "emit.ts");
    writeFileSync(file, SILENT, "utf-8");
    expect(check([file])).toHaveLength(0);
  });

  test("ignores files outside src/tools and assets/skills", () => {
    const dir = resolve(ROOT, "src/hooks");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, "hook.ts");
    writeFileSync(file, SILENT, "utf-8");
    expect(check([file])).toHaveLength(0);
  });

  test("flags each offending function separately", () => {
    const file = toolFile(
      "two.ts",
      `${SILENT}
function alsoRun() {
  save("/tmp/y");
  emit.ok("Saved again");
}
`
    );
    expect(check([file])).toHaveLength(2);
  });
});
