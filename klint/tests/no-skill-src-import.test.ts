import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import rules from "../../klint.rules";
import { runKlint } from "../core/runner";

function lint(skillCode: string, otherCode?: { path: string[]; content: string }) {
  const root = mkdtempSync(join(tmpdir(), "klint-skill-test-"));
  mkdirSync(join(root, "assets", "skills", "my-skill", "tools"), { recursive: true });

  writeFileSync(
    join(root, "assets", "skills", "my-skill", "tools", "subject.ts"),
    skillCode
  );

  if (otherCode) {
    const dir = join(root, ...otherCode.path.slice(0, -1));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, ...otherCode.path), otherCode.content);
  }

  const violations = runKlint(
    { root, include: ["."], rules: { "no-skill-src-import": "error" } },
    rules
  );
  rmSync(root, { recursive: true });
  return violations.filter((v) => v.rule === "no-skill-src-import");
}

describe("no-skill-src-import", () => {
  test("flags static import from repo src/", () => {
    const v = lint(`import { palHome } from "../../../../src/hooks/lib/paths";`);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("self-contained");
  });

  test("flags dynamic import from repo src/", () => {
    const v = lint(`const m = await import("../../../src/tools/foo");`);
    expect(v).toHaveLength(1);
  });

  test("does not flag relative import within skill", () => {
    const v = lint(`import { helper } from "../lib/utils";`);
    expect(v).toHaveLength(0);
  });

  test("does not flag node: built-in", () => {
    const v = lint(`import { readFileSync } from "node:fs";`);
    expect(v).toHaveLength(0);
  });

  test("does not flag npm package import", () => {
    const v = lint(`import { z } from "zod";`);
    expect(v).toHaveLength(0);
  });

  test("does not flag file outside assets/skills/", () => {
    const root = mkdtempSync(join(tmpdir(), "klint-skill-test-"));
    mkdirSync(join(root, "src", "hooks", "lib"), { recursive: true });
    writeFileSync(
      join(root, "src", "hooks", "lib", "subject.ts"),
      `import { foo } from "../../tools/src/bar";`
    );
    const violations = runKlint(
      { root, include: ["."], rules: { "no-skill-src-import": "error" } },
      rules
    );
    rmSync(root, { recursive: true });
    expect(violations.filter((v) => v.rule === "no-skill-src-import")).toHaveLength(0);
  });
});
