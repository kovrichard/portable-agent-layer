---
name: klint-rules
description: Add, modify, or explain klint architecture rules for this repo. Use when asked to enforce a new structural constraint, adjust rule scope, or explain why a violation fired.
argument-hint: <constraint to enforce>
---

## Workflow

1. **Understand the constraint** — if scope is ambiguous, ask: which files/layers are involved? should it block or warn? are there legitimate exceptions?

2. **Grep first** — verify the pattern exists and count current occurrences before touching `klint.yaml`:
   ```sh
   grep -rn "the-pattern" src/ --include="*.ts"
   ```

3. **Choose the right primitive:**

   | The constraint is... | Primitive |
   |---|---|
   | Layer X must not import from layer Y | `arch.imports` + `deny` |
   | Layer X may only import from Y and Z | `arch.imports` + `allow` |
   | Pattern P must only appear in one designated file | `arch.singleton` |
   | Pattern P must never appear inside a scoped layer | `arch.forbidden` |

4. **Read `klint.yaml`** — check existing `arch.layers` and rules before adding anything. Add a new named layer to `arch.layers` if the file group doesn't exist yet.

5. **Write the stanza** in `klint.yaml` under the correct `arch:` section.

6. **Verify zero new violations on the current codebase:**
   ```sh
   bun klint/cli.ts        # in-repo
   npx klint               # after npm install
   ```
   If new violations appear on existing code, fix them first or adjust the rule scope — then land the rule.

7. **Write a break test** — prove the rule fires on a deliberate violation, and doesn't fire on clean code. Run the test suite to confirm.

## Primitive reference

### Layers
```yaml
arch:
  layers:
    core:    ["src/lib/**", "src/hooks/**"]
    ui:      ["src/components/**"]
    targets: ["src/targets/**"]
```

### Import boundaries
```yaml
arch:
  imports:
    # deny: block imports from one layer into another
    - from: core
      deny: targets
      message: "Core must not depend on agent-specific code"
      severity: error          # optional — default is error; use warn to record without blocking

    # allow: whitelist — anything not listed is denied (npm + node: builtins always pass)
    - from: ["src/dao/**"]
      allow: ["src/dao/**", "src/prisma/**"]
      message: "DAO may only import from dao or prisma"

    # type-only: allow — import type {} is permitted even when value imports are denied
    - from: core
      deny: targets
      type-only: allow
      message: "Core must not depend on agent-specific code"
```

### Singleton — one designated location
```yaml
arch:
  singleton:
    - pattern: "process.env.API_KEY"
      only: "src/lib/auth.ts"
      in: ["src/**"]           # optional: limit scan scope (default: all files)
      message: "Use the auth module instead of reading API_KEY directly"
```

`pattern` is a **literal string match**. It fires if the pattern appears in any in-scope file except the `only` file.

### Forbidden — banned pattern in scope
```yaml
arch:
  forbidden:
    - pattern: "console.log("
      in: ["src/lib/**"]
      message: "Use the logger — console.log leaks into the agent event stream"
```

## Pitfalls

- `pattern` in `singleton` and `forbidden` is a **literal string** — will not catch `process.env["KEY"]` (bracket notation). Grep for both forms if both are possible.
- `only` in `singleton` is relative to the project root — use forward slashes on all platforms.
- `severity: warn` records the violation but does not block the session. Use `error` (the default) to block.
- Path aliases (`@/*`) resolve via `tsconfig.json` `compilerOptions.paths`, including `extends` chains.
- Adding a rule that fires on existing code is not a blocker — fix the violations first, then add the rule.

## Output format

After adding or modifying a rule, report:
- The YAML stanza added
- The grep evidence that confirmed the pattern is real
- The test written and its result
- The output of `bun run klint` (or `npx klint`) confirming zero new violations

## Do NOT use

- To fix TypeScript type errors, lint issues, or Biome violations — those are separate tools
- To enforce naming conventions (hooks must start with `use`, components must be PascalCase) — use ESLint with the appropriate plugin
- To write custom TypeScript AST rules in `klint.rules.ts` — that is a separate, code-level workflow
