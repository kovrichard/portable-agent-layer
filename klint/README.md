# klint

The bridge between vibe coding and agentic engineering.

## Why

Biome and oxlint enforce syntax-level style. klint enforces architecture-level rules — the kind that require TypeScript's type graph, span multiple files, or encode constraints that an AI agent must not bypass. If a rule needs to know that `fetchUser()` returns `Promise<User>`, or that sync filesystem calls are banned inside async hooks, that's a klint rule.

Rules give your agent freedom. Without constraints, every decision is a risk. With klint, your agent knows exactly where it can move fast — and where it can't.

## Architecture as Code

klint's YAML config supports an `arch:` section that lets you define architectural rules declaratively — no code required.

> **AGENTS.md tells the model what to do. Klint ensures it actually did.**
>
> Instructions in a prompt are a contract with no enforcement. A model that's drifting, context-starved, or just wrong will violate AGENTS.md silently and ship anyway. Klint makes the violation structurally impossible to land — the gate blocks it regardless of what the model thought it understood.

### Layers

Define named file groups once, reference them everywhere:

```yaml
arch:
  layers:
    core:   ["src/hooks/lib/**", "src/tools/**"]
    skills: ["assets/skills/**"]
```

### Import boundaries

```yaml
arch:
  imports:
    # deny: block imports from one layer into another
    - from: skills
      deny: core
      message: "Skills must be self-contained and portable"
      severity: warn          # optional, default: error

    # allow: whitelist mode — anything not listed is denied (npm/node: builtins always pass)
    - from: ["src/dao/**"]
      allow: ["src/dao/**", "src/prisma/**", "src/types/**"]
      message: "DAO may only import from dao, prisma, or types"

    # type-only: allow — import type {} is permitted even when value imports are denied
    - from: core
      deny: ["src/targets/**"]
      type-only: allow
      message: "Core must not depend on agent-specific code"
```

### Forbidden patterns

Block literal string patterns inside a scoped layer:

```yaml
arch:
  forbidden:
    - pattern: "console.log("
      in: core
      message: "Leaks into the agent event stream — use the hook output API instead"

    - pattern: "process.exit("
      in: ["src/hooks/lib/**"]
      message: "Library functions should return or throw, not terminate the process"
```

### Singleton locations

Enforce that a pattern appears only in one designated file:

```yaml
arch:
  singleton:
    - pattern: "process.env.PAL_HOME"
      only: "src/hooks/lib/paths.ts"
      in: ["src/**"]                  # optional: limit scan scope
      message: "Use the paths module"

    - pattern: "process.env.API_KEY"
      only: "src/lib/auth.ts"
      message: "Use the auth module"
```

### Agent integration

Wire `--json` into your Stop hook so violations are machine-readable:

```typescript
// .agents/hooks/klint.ts
import { runHook } from "./run-hook";
const exitCode = runHook(["bun", "klint/cli.ts", "--json"]);
process.exit(exitCode);
```

On errors the hook exits 2 (blocking) and emits:

```json
{
  "violations": [
    {
      "rule": "arch/imports",
      "file": "assets/skills/telos/tools/update-telos.ts",
      "line": 23,
      "severity": "warn",
      "message": "Skills must be self-contained and portable",
      "fix": null
    }
  ],
  "summary": { "errors": 0, "warnings": 1 }
}
```

The agent reads the structured violations and fixes them before the session can close.

---

## Usage

```sh
bun klint/cli.ts [--config <dir>] [--rules <file>] [--fix] [--json]
```

| Flag | Description |
|------|-------------|
| `--config <dir>` | Directory containing `klint.yaml` or `klint.config.json` (default: cwd) |
| `--rules <file>` | Path to custom rules file (default: auto-discovered — see below) |
| `--fix` | Apply auto-fixes for fixable violations in-place |
| `--json` | Emit structured JSON to stdout (for agent/CI consumption) |

If `--rules` is omitted, klint looks for `klint.rules.ts` next to the config file. If it exists it is loaded automatically; if it doesn't, no custom rules are used.

## Configuration

**`klint.yaml`** — lives at your project root alongside `biome.json` and `knip.json`:

```yaml
# yaml-language-server: $schema=./klint.schema.yaml

include: ["src", "klint", "!**/node_modules/**"]
plugins: [sonar]
rules:
  no-unguarded-json-parse: error
  no-sync-in-async:
    severity: error
    include: ["src/hooks/**"]
  no-floating-promise: error
  my-custom-rule: warn

arch:
  layers:
    core: ["src/hooks/lib/**", "src/tools/**"]
  imports:
    - from: ["assets/skills/**"]
      deny: ["src/**"]
      message: "Skills must be self-contained"
      severity: warn
```

`include` — glob patterns selecting which `.ts` files to lint.  
`plugins` — named rule bundles (`"sonar"`) that apply a default set of rules.  
`rules` — map of rule name → `"error" | "warn" | "off"` or an options object with `severity` and/or `include`.  
`arch` — declarative architecture constraints (see Architecture as Code above).

A `klint.config.json` fallback is supported for backwards compatibility.

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

All exported rules run at `"error"` severity by default. Override severity or scope them via `rules` in `klint.yaml` — the same mechanism as built-in rules:

```yaml
rules:
  my-custom-rule: warn
  my-scoped-rule:
    severity: error
    include: ["src/hooks/**"]
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

```yaml
no-sync-in-async:
  severity: error
  include: ["src/hooks/**", "!src/hooks/scripts/**"]
```

## Architecture

```
klint/
  cli.ts          — CLI entry point; discovers config + rules, reports violations
  core/
    types.ts      — KlintRule, KlintConfig, ArchConfig, Violation, RuleEntry
    runner.ts     — runKlint(); resolves files, dispatches rules, calls arch engine
    arch.ts       — runArchRules(); AST import scanner, layers/imports/forbidden/singleton
    ast.ts        — walkAst(), createProgram(), nearestFunctionIsAsync(), isInsideTry()
    fixer.ts      — applyFixes(); bottom-up line-range patch with overlap detection
  rules/
    index.ts      — BUILT_IN_RULES registry
    ...
  tests/
    ...
```

The `klint/` directory is intentionally decoupled from the rest of the codebase — no imports cross the boundary in either direction. When it has enough rules, it ships as a standalone package.
