---
name: klint-rules
description: Add, modify, or explain klint architecture rules for this repo. Use when asked to enforce a new structural constraint, adjust rule scope, or explain why a violation fired.
argument-hint: <constraint to enforce>
---

## Schema

The full, authoritative config schema lives in the repo and is the source of truth for every field below:

- YAML: <https://github.com/konvert7/klint/blob/main/klint.schema.yaml>
- JSON: <https://github.com/konvert7/klint/blob/main/klint.schema.json>

Wire it into `klint.yaml` for editor autocomplete and validation:

```yaml
# yaml-language-server: $schema=./klint.schema.yaml
```

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
   | Layer X must not import an npm package or `node:` builtin | `arch.imports` + `deny-packages` |
   | Pattern P must only appear in one designated file | `arch.singleton` + `pattern` |
   | Pattern P must never appear inside a scoped layer | `arch.forbidden` + `pattern` |
   | Raw HTML/JSX element must never appear in a scoped layer | `arch.forbidden` + `jsx-element` |
   | Raw HTML/JSX element may only appear in one primitive file | `arch.singleton` + `jsx-element` |
   | A value-shaped pattern (regex) must never appear in a scoped layer | `arch.forbidden` + `pattern: "re:…"` |
   | No file in a layer may exceed N lines | `arch.maxLines` + `limit` |
   | No file may be more than N% comments | `arch.maxCommentDensity` + `limit` |
   | No comment block may stack more than N lines | `arch.maxCommentBlock` + `limit` |

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

    # type-only: allow — import type {} and Python if TYPE_CHECKING: blocks stay permitted
    - from: core
      deny: targets
      type-only: allow
      message: "Core must not depend on agent-specific code"

    # deny-packages: block npm packages and node: builtins, which deny/allow cannot reach
    # because they never resolve to a project file. Composes with deny in the same rule.
    - from: ["src/dao/**"]
      deny-packages: ["next/headers", "node:fs"]
      message: "Data access must not read request state or touch the filesystem"
```

`deny-packages` matches per segment: `next` covers `next/headers`, `nextra` is unaffected, and
`next/headers` does not match `next/navigation`. Python uses dotted segments, so `os` covers
`os.path` and blocks pip packages and stdlib modules alike. Swift uses dotted segments too, at
module granularity, which is what makes system frameworks like `UIKit` reachable. Rust splits on
`::`, so `tokio` covers `tokio::sync::Mutex` while `tokio_util` is unaffected. The specifier is read off the AST, so
static imports, dynamic `import()`, and `export … from` re-exports all count while a comment
mentioning the package does not — unlike `forbidden` + `pattern`, which is a line-based text scan.

### Singleton — one designated location

Pin a `pattern` (literal string) **or** a `jsx-element` (AST-matched tag) to exactly one file. Every other in-scope occurrence is a violation.

```yaml
arch:
  singleton:
    # pattern: literal string match — fires if it appears anywhere except `only`
    - pattern: "process.env.API_KEY"
      only: "src/lib/auth.ts"
      in: ["src/**"]           # optional: limit scan scope (default: all files). string OR array
      message: "Use the auth module instead of reading API_KEY directly"
      severity: error          # optional — default error; use warn to record without blocking

    # jsx-element: pin a raw element to its design-system primitive
    - jsx-element: "button"     # one tag, or a list: ["button", "input"]
      only: "src/components/ui/button.tsx"
      in: ["src/**/*.tsx"]
      message: "Raw <button> belongs only to the Button primitive"
```

Required: `only` + `message`, plus one of `pattern` / `jsx-element` (not both in the same stanza).

### Forbidden — banned pattern in scope

Block a `pattern` (literal string) **or** a `jsx-element` (AST-matched tag) inside a scoped layer.

```yaml
arch:
  forbidden:
    # pattern: literal substring by default; prefix with `re:` for a regex
    - pattern: "console.log("
      in: ["src/lib/**"]       # string OR array; supports ! negation
      message: "Use the logger — console.log leaks into the agent event stream"
      severity: error          # optional — default error; use warn to record without blocking

    # re: prefix — match a regular expression (common JS/RE2 subset; no lookaround/backrefs)
    - pattern: 're:\b(?:p|gap)-\['
      in: ["src/**/*.tsx"]
      message: "Use the spacing scale, not arbitrary bracket values like p-[18px]"

    # jsx-element: forbid raw HTML elements outside the design system
    - jsx-element: ["button", "input", "label"]
      in: ["src/app/**/*.tsx", "src/components/**/*.tsx", "!src/components/ui/**"]
      message: "Use the design-system primitives in @/components/ui/* instead of raw HTML elements"
```

Required: `in` + `message`, plus one of `pattern` / `jsx-element` (not both in the same stanza). A `pattern` may be a literal substring or, with the `re:` prefix, a regex; `singleton` patterns accept `re:` too.

`jsx-element` matches intrinsic element names on the AST (opening and self-closing tags), so it is robust to whitespace, attributes, and naming collisions like `<buttonGroup>` — unlike a literal `pattern: "<button"` scan. It works on `.tsx`/`.jsx` files in both the TS and Rust engines.

### Max lines — cap file length

Limit how many physical lines a file in scope may have. Use a separate stanza per scope to give different ceilings to source and tests.

```yaml
arch:
  maxLines:
    - limit: 300               # positive integer; required
      in: ["src/**"]           # string OR array; supports ! negation
      message: "Split this module"   # optional — defaults to "File exceeds the maximum of N lines"
      severity: error          # optional — default error; use warn to record without blocking

    - limit: 600               # tests may run longer
      in: ["tests/**"]
```

Required: `limit` + `in`. The count is **total physical lines** — blanks and comments included, not code lines — and a file over the limit is flagged at line `limit + 1`. Enforced identically in the TS and Rust engines, across every language klint scans.

### Comment budget — cap explanatory prose

Two ceilings on how much of a file may be comments. Use them to push intent into names and small
functions rather than paragraphs that drift from the code they describe.

```yaml
arch:
  # maxCommentDensity: what share of a file may be comment lines
  maxCommentDensity:
    - limit: 5                 # percent; required
      in: ["src/**"]           # string OR array; supports ! negation
      countDocComments: false  # optional — default false, so JSDoc/docstrings are exempt
      message: "Encode intent in names and small functions, not prose"
      severity: error          # optional — default error; use warn to record without blocking

  # maxCommentBlock: how tall a single stack of comment lines may get
  maxCommentBlock:
    - limit: 2                 # consecutive comment lines; required
      in: ["src/**"]
      ignore: ["@codegen:"]    # optional — structural markers, not prose
      message: "Extract a well-named function instead of stacking comment lines"
```

Required: `limit` + `in`. Density is a **percentage of total physical lines** (code + comments +
blanks — the same denominator `maxLines` uses). Block height counts **consecutive** comment lines and
is reported at the first offending line. Both exempt doc-comments by default — `/** … */` JSDoc and
Python docstrings — so documentation is not penalised; ordinary `//`, `/* */`, and `#` comments always
count. Set `countDocComments: true` to include them.

The two are complementary: density catches a file that is 30% commented in scattered one-liners,
block catches a ten-line essay above one function in an otherwise sparse file. Neither alone catches both.

**`ignore` — comments that are machinery, not prose.** Some comments are load-bearing input to a
build or codegen step (`// @codegen:region-start`, feature-strip markers, pragmas). They are comments to the
lexer but structure to the project, and counting them makes both limits measure the wrong thing:

```yaml
arch:
  maxCommentDensity:
    - limit: 5
      in: ["src/**"]
      ignore: ["@codegen:"]         # literal substring, or "re:" for a regex
```

Two rules govern how an ignored line behaves, and both matter:

- **It stays in the density denominator.** A marker is a physical line like code, so a 20-line file
  with 4 markers and 1 real comment measures 1/20, not 1/16.
- **It does not break a comment block.** `// a` / `// @marker` / `// b` / `// c` is a run of three
  counted lines, not two runs. Otherwise sprinkling a marker every other line would defeat the cap.

`ignore` tests the **physical source line**, so it only ever applies to lines already identified as
comments — code containing the same text is untouched. Enforced identically in both engines.

## Pitfalls

- `pattern` in `singleton` and `forbidden` is a **literal substring** by default — it will not catch `process.env["KEY"]` (bracket notation). Either grep for both forms, or use a `re:` regex prefix to match them in one rule. Caveat: a literal pattern that itself begins with `re:` cannot be expressed (it is always read as a regex), and regexes must stay in the common JS/RE2 subset (no lookaround or backreferences) so both engines agree.
- `maxLines.limit` counts **total physical lines** (blanks and comments included), not code lines; a trailing newline does not add a line, and both engines count identically.
- `maxCommentDensity.limit` is a **percentage, not a line count** — `limit: 5` means 5% of the file, so a 40-line file is over budget at its third comment line. Measure before picking a number: land it as `severity: warn` first, read the reported densities, then tighten to `error`.
- `jsx-element` matches **intrinsic** (lowercase HTML) tags only — `button`, `input`, `label`. It does not match custom React components like `<Button>`; to restrict those, use `arch.imports` against the component's module instead.
- A `forbidden`/`singleton` stanza takes either `pattern` or `jsx-element`, never both — split into two stanzas if you need both.
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
