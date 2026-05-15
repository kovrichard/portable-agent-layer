# klint

The bridge between vibe coding and agentic engineering.

## Why

Biome and oxlint enforce syntax-level style. klint enforces architecture-level rules — the kind that require TypeScript's type graph, span multiple files, or encode constraints that an AI agent must not bypass. If a rule needs to know that `fetchUser()` returns `Promise<User>`, or that sync filesystem calls are banned inside async hooks, that's a klint rule.

Rules give your agent freedom. Without constraints, every decision is a risk. With klint, your agent knows exactly where it can move fast — and where it can't.

## Usage

```sh
bun klint/cli.ts [--config <dir>] [--rules <file>] [--fix]
```

| Flag | Description |
|------|-------------|
| `--config <dir>` | Directory containing `klint.config.json` (default: cwd) |
| `--rules <file>` | Path to custom rules file (default: auto-discovered — see below) |
| `--fix` | Apply auto-fixes for fixable violations in-place |

If `--rules` is omitted, klint looks for `klint.rules.ts` next to `klint.config.json`. If the file exists it is loaded automatically; if it doesn't, no custom rules are used and no error is raised.

## Configuration

**`klint.config.json`** — lives at your project root alongside `biome.json` and `knip.json`:

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
`customRules` — names of rules defined in `klint.rules.ts`.

## Built-in Rules

| Rule | Type-aware | Description |
|------|-----------|-------------|
| `no-unguarded-json-parse` | No | `JSON.parse()` called outside a try/catch |
| `no-sync-in-async` | No | Sync filesystem calls (`readFileSync` etc.) inside async functions |
| `no-floating-promise` | **Yes** | Promise-returning call whose result is discarded |
| `no-misused-promises` | **Yes** | Async function passed where a sync callback is expected |

## Custom Rules

Create `klint.rules.ts` at your project root and export a `KlintRule[]` as default:

```ts
import { relative } from "node:path";
import { defineRule } from "./klint/core/types";

export default [
  defineRule({
    name: "my-custom-rule",
    check({ files, root, fileContents }, violations) {
      for (const file of files) {
        const lines = (fileContents.get(file) ?? "").split("\n");
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

Reference the rule name in `customRules` inside `klint.config.json`.

For type-aware rules, use `createProgram` from `klint/core/ast`:

```ts
import { createProgram } from "./klint/core/ast";

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
klint/
  cli.ts          — CLI entry point; discovers config + rules, reports violations
  core/
    types.ts      — KlintRule, KlintConfig, Violation, RuleEntry
    runner.ts     — runKlint(); resolves files, dispatches rules
    ast.ts        — walkAst(), createProgram(), nearestFunctionIsAsync(), isInsideTry()
    fixer.ts      — applyFixes(); bottom-up line-range patch with overlap detection
  rules/
    index.ts      — BUILT_IN_RULES registry
    ...
  tests/
    ...
```

The `klint/` directory is intentionally decoupled from the rest of the codebase — no imports cross the boundary in either direction. When it has enough rules, it ships as a standalone package.
