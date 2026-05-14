# Flint

Type-aware lint rules for TypeScript, written in TypeScript.

## Why

Biome and oxlint are fast and excellent for syntax-level rules. Flint fills the gap they can't: rules that require the TypeScript type graph. If a rule needs to know that `fetchUser()` returns `Promise<User>` — not just that it looks like a function call — that's a Flint rule.

## Usage

```sh
bun flint/cli.ts [--config <dir>] [--rules <file>]
```

| Flag | Description |
|------|-------------|
| `--config <dir>` | Directory containing `flint.config.json` (default: cwd) |
| `--rules <file>` | Path to custom rules file (default: auto-discovered — see below) |

If `--rules` is omitted, flint looks for `flint.rules.ts` next to `flint.config.json`. If the file exists it is loaded automatically; if it doesn't, no custom rules are used and no error is raised. Use `--rules` to point to a rules file in a non-default location.

## Configuration

**`flint.config.json`** — lives at your project root alongside `biome.json` and `knip.json`:

```json
{
  "include": ["src"],
  "rules": [
    "no-unguarded-json-parse",
    { "rule": "no-sync-in-async", "include": ["src/hooks/**"] },
    "no-floating-promise",
    "no-misused-promises"
  ],
  "customRules": [
    "my-custom-rule"
  ]
}
```

`rules` — built-in rule names (strings) or scoped entries with per-rule `include`/exclude patterns.  
`customRules` — names of rules defined in `flint.rules.ts`.

## Built-in Rules

| Rule | Type-aware | Description |
|------|-----------|-------------|
| `no-unguarded-json-parse` | No | `JSON.parse()` called outside a try/catch |
| `no-sync-in-async` | No | Sync filesystem calls (`readFileSync` etc.) inside async functions |
| `no-floating-promise` | **Yes** | Promise-returning call whose result is discarded |
| `no-misused-promises` | **Yes** | Async function passed where a sync callback is expected |

## Custom Rules

Create `flint.rules.ts` at your project root and export a `FlintRule[]` as default:

```ts
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { defineRule } from "./flint/core/types";

export default [
  defineRule({
    name: "my-custom-rule",
    check({ files, root }, violations) {
      for (const file of files) {
        const lines = readFileSync(file, "utf-8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (/forbidden-pattern/.test(lines[i])) {
            violations.push({
              file: relative(root, file),
              line: i + 1,
              rule: "my-custom-rule",
              message: "Explain what's wrong and how to fix it.",
            });
          }
        }
      }
    },
  }),
];
```

Reference the rule name in `customRules` inside `flint.config.json`.

For type-aware rules, use `createProgram` from `flint/core/ast`:

```ts
import { createProgram } from "./flint/core/ast";

// inside check():
const program = createProgram(files, root);
const checker = program.getTypeChecker();
```

## Scoped Includes

Any rule can be restricted to a file subset using an object entry in `rules` or `customRules`:

```json
{ "rule": "no-sync-in-async", "include": ["src/hooks/**", "!src/hooks/scripts/**"] }
```

Patterns support `**` globs and negation with `!` — same syntax as Biome.

## Architecture

```
flint/
  cli.ts          — CLI entry point; discovers config + rules, reports violations
  core/
    types.ts      — FlintRule, FlintConfig, Violation, RuleEntry
    runner.ts     — runFlint(); resolves files, dispatches rules
    ast.ts        — walkAst(), createProgram(), nearestFunctionIsAsync(), isInsideTry()
  rules/
    index.ts      — BUILT_IN_RULES registry
    no-unguarded-json-parse.ts
    no-sync-in-async.ts
    no-floating-promise.ts
    no-misused-promises.ts
  tests/
    no-floating-promise.test.ts
    no-misused-promises.test.ts
```

The `flint/` directory is intentionally decoupled from the rest of the codebase — no imports cross the boundary in either direction. When it has enough rules, it ships as a standalone package.
