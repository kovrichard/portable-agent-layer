import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKlint } from "../core/runner";
import type { ArchConfig } from "../core/types";

function lint(arch: ArchConfig, files: { path: string[]; content: string }[]) {
  const root = mkdtempSync(join(tmpdir(), "klint-arch-forbidden-"));
  for (const f of files) {
    mkdirSync(join(root, ...f.path.slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...f.path), f.content);
  }
  const violations = runKlint({ root, include: ["."], rules: {}, arch }, {});
  rmSync(root, { recursive: true });
  return violations.filter((v) => v.rule === "arch/forbidden");
}

describe("arch/forbidden", () => {
  test("flags pattern found in the scoped layer", () => {
    const v = lint(
      {
        layers: { lib: ["src/lib/**"] },
        forbidden: [
          {
            pattern: "console.log(",
            in: "lib",
            message: "Leaks into agent event stream",
          },
        ],
      },
      [
        {
          path: ["src", "lib", "utils.ts"],
          content: `export function debug() { console.log("hi"); }`,
        },
      ]
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toBe("Leaks into agent event stream");
    expect(v[0].rule).toBe("arch/forbidden");
    expect(v[0].severity).toBe("error");
  });

  test("does not flag pattern found outside the scoped layer", () => {
    const v = lint(
      {
        layers: { lib: ["src/lib/**"] },
        forbidden: [
          {
            pattern: "console.log(",
            in: "lib",
            message: "Leaks into agent event stream",
          },
        ],
      },
      [
        // this file is outside src/lib — not in scope
        {
          path: ["src", "scripts", "debug.ts"],
          content: `console.log("debugging");`,
        },
      ]
    );
    expect(v).toHaveLength(0);
  });

  test("does not flag when pattern is absent", () => {
    const v = lint(
      {
        layers: { lib: ["src/lib/**"] },
        forbidden: [
          {
            pattern: "console.log(",
            in: "lib",
            message: "Leaks into agent event stream",
          },
        ],
      },
      [{ path: ["src", "lib", "utils.ts"], content: `export const x = 1;` }]
    );
    expect(v).toHaveLength(0);
  });

  test("flags each line containing the pattern", () => {
    const v = lint(
      {
        layers: { lib: ["src/lib/**"] },
        forbidden: [
          { pattern: "process.exit(", in: "lib", message: "Use throw instead" },
        ],
      },
      [
        {
          path: ["src", "lib", "utils.ts"],
          content: `if (err) process.exit(1);\nif (fatal) process.exit(2);`,
        },
      ]
    );
    expect(v).toHaveLength(2);
    expect(v[0].line).toBe(1);
    expect(v[1].line).toBe(2);
  });

  test("respects severity override", () => {
    const v = lint(
      {
        layers: { lib: ["src/lib/**"] },
        forbidden: [
          {
            pattern: "console.log(",
            in: "lib",
            message: "Use logger",
            severity: "warn",
          },
        ],
      },
      [
        {
          path: ["src", "lib", "utils.ts"],
          content: `console.log("x");`,
        },
      ]
    );
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe("warn");
  });

  test("supports raw glob as in value (no named layer needed)", () => {
    const v = lint(
      {
        forbidden: [{ pattern: "console.log(", in: "src/lib/**", message: "Leaks" }],
      },
      [{ path: ["src", "lib", "utils.ts"], content: `console.log("hi");` }]
    );
    expect(v).toHaveLength(1);
  });
});
