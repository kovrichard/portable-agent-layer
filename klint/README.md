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
  "plugins": ["sonar"],
  "rules": {
    "no-unguarded-json-parse": "error",
    "no-sync-in-async": { "severity": "error", "include": ["src/hooks/**"] },
    "no-floating-promise": "error",
    "my-custom-rule": "warn"
  }
}
```

`include` — glob patterns selecting which `.ts` files to lint.  
`plugins` — named rule bundles (`"sonar"`) that apply a default set of rules.  
`rules` — map of rule name → `"error" | "warn" | "off"` or an options object with `severity` and/or `include`. Applies to both built-in and custom rules.

## Built-in Rules

| Rule | Type-aware | Description |
|------|-----------|-------------|
| `no-unguarded-json-parse` | No | `JSON.parse()` called outside a try/catch |
| `no-sync-in-async` | No | Sync filesystem calls (`readFileSync` etc.) inside async functions |
| `no-floating-promise` | **Yes** | Promise-returning call whose result is discarded |
| `no-misused-promises` | **Yes** | Async function passed where a sync callback is expected |

## Custom Rules

Create `klint.rules.ts` at your project root and export a `Record<string, KlintRule>` as default. Each key is the rule name:

```ts
import { relative } from "node:path";
import type { KlintRule } from "./klint/core/types";

const myCustomRule: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const lines = (fileContents.get(file) ?? "").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (/forbidden-pattern/.test(lines[i])) {
          violations.push({
            file: relative(root, file),
            line: i + 1,
            message: "Explain what's wrong and how to fix it.",
          });
        }
      }
    }
  },
};

export default {
  "my-custom-rule": myCustomRule,
};
```

All exported rules run at `"error"` severity by default. Override severity or scope them to specific files via `rules` in `klint.config.json` — the same mechanism as built-in rules:

```json
{
  "rules": {
    "my-custom-rule": "warn",
    "my-scoped-rule": { "severity": "error", "include": ["src/hooks/**"] }
  }
}
```

No separate registration step — everything exported from `klint.rules.ts` is picked up automatically.

### Auto-fix support

Add a `fix` field to a violation to make it auto-fixable with `--fix`. The fix replaces a line range with new text:

```ts
violations.push({
  file: relative(root, file),
  line: i + 1,
  message: "Use foo() instead of bar().",
  fix: {
    startLine: i + 1,
    endLine: i + 1,
    replacement: lines[i].replace("bar()", "foo()"),
  },
});
```

### Type-aware rules

For rules that need TypeScript's type checker, use `walkAst` from `klint/core/ast`:

```ts
import ts from "typescript";
import { walkAst } from "./klint/core/ast";

const myTypeAwareRule: KlintRule = {
  check({ files, root, fileContents }, violations) {
    for (const file of files) {
      const content = fileContents.get(file) ?? "";
      walkAst(file, content, (node, src) => {
        if (ts.isCallExpression(node)) {
          // inspect node using the TypeScript AST
        }
      });
    }
  },
};
```

## Scoped includes

Any rule can be restricted to a file subset via the `include` option. Patterns support `**` globs and negation with `!`:

```json
"no-sync-in-async": { "severity": "error", "include": ["src/hooks/**", "!src/hooks/scripts/**"] }
```

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
