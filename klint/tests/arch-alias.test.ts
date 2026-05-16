import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKlint } from "../core/runner";
import type { ArchConfig } from "../core/types";

function lint(
  arch: ArchConfig,
  files: { path: string[]; content: string }[],
  tsconfig?: object
) {
  const root = mkdtempSync(join(tmpdir(), "klint-arch-alias-"));
  if (tsconfig) {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  }
  for (const f of files) {
    mkdirSync(join(root, ...f.path.slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...f.path), f.content);
  }
  const violations = runKlint({ root, include: ["."], rules: {}, arch }, {});
  rmSync(root, { recursive: true });
  return violations.filter((v) => v.rule === "arch/imports");
}

const TSCONFIG_WITH_ALIAS = {
  compilerOptions: {
    baseUrl: ".",
    paths: {
      "@/*": ["src/*"],
    },
  },
};

const LAYERS: ArchConfig["layers"] = {
  skills: ["assets/skills/**"],
  core: ["src/**"],
};

describe("arch/imports — path alias resolution", () => {
  test("flags alias import that resolves into denied layer", () => {
    const v = lint(
      {
        layers: LAYERS,
        imports: [
          { from: "skills", deny: "core", message: "Skills must be self-contained" },
        ],
      },
      [
        {
          path: ["assets", "skills", "my-skill", "tools", "index.ts"],
          content: `import { foo } from "@/lib/utils";`,
        },
        { path: ["src", "lib", "utils.ts"], content: `export const foo = 1;` },
      ],
      TSCONFIG_WITH_ALIAS
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("self-contained");
    expect(v[0].rule).toBe("arch/imports");
  });

  test("does not flag alias import that resolves outside denied layer", () => {
    const v = lint(
      {
        layers: LAYERS,
        imports: [{ from: "skills", deny: "core" }],
      },
      [
        {
          // imports from @/lib/utils but via a tsconfig that maps @/ to assets/ not src/
          path: ["assets", "skills", "my-skill", "tools", "index.ts"],
          content: `import { foo } from "@/lib/utils";`,
        },
        { path: ["assets", "lib", "utils.ts"], content: `export const foo = 1;` },
      ],
      {
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["assets/*"] },
        },
      }
    );
    expect(v).toHaveLength(0);
  });

  test("does not flag alias import when no tsconfig exists", () => {
    // Without tsconfig, @/lib/utils is a bare specifier and skipped like an npm package
    const v = lint(
      {
        layers: LAYERS,
        imports: [{ from: "skills", deny: "core" }],
      },
      [
        {
          path: ["assets", "skills", "my-skill", "tools", "index.ts"],
          content: `import { foo } from "@/lib/utils";`,
        },
        { path: ["src", "lib", "utils.ts"], content: `export const foo = 1;` },
      ]
      // no tsconfig argument
    );
    // without tsconfig, @/lib/utils is treated as a bare specifier and skipped
    expect(v).toHaveLength(0);
  });

  test("still skips real npm packages when tsconfig is present", () => {
    const v = lint(
      {
        layers: LAYERS,
        imports: [{ from: "skills", deny: "core" }],
      },
      [
        {
          path: ["assets", "skills", "my-skill", "tools", "index.ts"],
          content: `import { z } from "zod";`,
        },
      ],
      TSCONFIG_WITH_ALIAS
    );
    expect(v).toHaveLength(0);
  });

  test("parses tsconfig with JSONC comments without crashing", () => {
    const root = mkdtempSync(join(tmpdir(), "klint-arch-alias-jsonc-"));
    // Write tsconfig with comments — ts.readConfigFile handles JSONC
    writeFileSync(
      join(root, "tsconfig.json"),
      `{
  // strict mode
  "compilerOptions": {
    "baseUrl": ".",
    /* path aliases */
    "paths": {
      "@/*": ["src/*"]
    }
  }
}`
    );
    mkdirSync(join(root, "assets", "skills", "my-skill", "tools"), { recursive: true });
    writeFileSync(
      join(root, "assets", "skills", "my-skill", "tools", "index.ts"),
      `import { foo } from "@/lib/utils";`
    );
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    writeFileSync(join(root, "src", "lib", "utils.ts"), `export const foo = 1;`);

    const violations = runKlint(
      {
        root,
        include: ["."],
        rules: {},
        arch: {
          layers: LAYERS,
          imports: [{ from: "skills", deny: "core", message: "no" }],
        },
      },
      {}
    ).filter((v) => v.rule === "arch/imports");

    rmSync(root, { recursive: true });
    expect(violations).toHaveLength(1);
  });

  test("resolves alias defined in extended tsconfig", () => {
    const root = mkdtempSync(join(tmpdir(), "klint-arch-alias-extends-"));
    // Base tsconfig defines the paths
    writeFileSync(
      join(root, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } })
    );
    // Child tsconfig extends the base — no paths of its own
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base.json" })
    );
    mkdirSync(join(root, "assets", "skills", "my-skill", "tools"), { recursive: true });
    writeFileSync(
      join(root, "assets", "skills", "my-skill", "tools", "index.ts"),
      `import { foo } from "@/lib/utils";`
    );
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    writeFileSync(join(root, "src", "lib", "utils.ts"), `export const foo = 1;`);

    const violations = runKlint(
      {
        root,
        include: ["."],
        rules: {},
        arch: {
          layers: LAYERS,
          imports: [
            { from: "skills", deny: "core", message: "Skills must be self-contained" },
          ],
        },
      },
      {}
    ).filter((v) => v.rule === "arch/imports");

    rmSync(root, { recursive: true });
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("self-contained");
  });

  test("exact alias (no wildcard) resolves correctly", () => {
    const v = lint(
      {
        layers: LAYERS,
        imports: [{ from: "skills", deny: "core", message: "no" }],
      },
      [
        {
          path: ["assets", "skills", "my-skill", "tools", "index.ts"],
          // exact alias: "@config" → "src/config"
          content: `import { cfg } from "@config";`,
        },
        { path: ["src", "config.ts"], content: `export const cfg = {};` },
      ],
      {
        compilerOptions: {
          baseUrl: ".",
          paths: { "@config": ["src/config"] },
        },
      }
    );
    expect(v).toHaveLength(1);
  });
});
