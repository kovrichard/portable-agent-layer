---
name: eval-prompt
description: Evaluate a PAL inference prompt using the promptfoo harness in eval/. Use when a prompt constant in src/ has changed or may have regressed, when scaffolding a new prompt eval from scratch, or when comparing a v2 candidate against the current baseline.
argument-hint: <prompt-name> [promptfoo-flags]
metadata:
  triggers:
    - "eval-prompt"
    - "eval prompt"
    - "promptfoo"
    - "prompt regression"
    - "prompt eval"
---

# eval-prompt

Maintainer-only skill. Operates on the `eval/` directory of the PAL repo. Do not use outside this repo.

## Workflow

### Running an existing eval

1. Run the eval, forwarding any extra flags the user passed:
   ```bash
   bun eval/run.ts <prompt-name> [--providers haiku] [--no-cache] [--filter-pattern "A1"]
   ```
2. Read the results table. For each failing test, note the prompt column (v1 vs v2) and the expected vs actual `sentiment`/`rating` field.
3. Report: pass rate per prompt, which cases failed, and whether v2 outperforms v1.

### Crystallizing a winning prompt

When v2 passes ≥95% of cases and outperforms v1 on its target failures:

1. Copy the winning prompt text back into its source constant in `src/` (read the source file first to locate the constant).
2. Overwrite v1 with v2: `cp eval/<name>/prompts/v2-<desc>.json eval/<name>/prompts/v1-current.json`
3. Remove or archive the v2 file.
4. Run the eval again to confirm v1 now passes at the higher rate.

### Scaffolding a new eval

When no `eval/<name>/` exists yet:

1. Create the folder structure:
   ```
   eval/<name>/
     promptfoo.yaml
     prompts/
       v1-current.json
     assertions/
   ```

2. Extract the current prompt from `src/` into `eval/<name>/prompts/v1-current.json` using chat format:
   ```json
   [
     { "role": "system", "content": "<system prompt text>" },
     { "role": "user",   "content": "{{userMessage}}" }
   ]
   ```
   If the production code calls `injectJsonSchemaInstruction()`, append the schema instruction to the system prompt string — that is what the model receives.

3. Write `promptfoo.yaml`. Use this template:
   ```yaml
   description: "<name> — v1 baseline vs v2 candidate"

   prompts:
     - file://prompts/v1-current.json

   providers:
     - id: anthropic:messages:claude-haiku-4-5-20251001
       label: haiku
       config:
         output_format:
           type: json_schema
           schema: <paste the output JSON schema here>
     - id: openai:chat:gpt-4o-mini
       label: gpt-4o-mini

   defaultTest:
     assert:
       - type: javascript
         value: file://assertions/valid-json.js
         description: "Output must be a parseable JSON object"

   tests: []
   ```

4. Write assertion files. Each file is one line using the shared factory in `eval/lib/assert.js`:
   ```js
   // assertions/not-negative.js
   const { makeCheck } = require("../../lib/assert");
   module.exports = makeCheck("sentiment", "ne", "negative");
   ```
   Available ops: `'eq'` `'ne'` `'null'` `'not-null'`.
   For custom logic, write a plain function that calls `require("../../lib/parse-output")` directly.

5. Write labeled test cases in `promptfoo.yaml`:
   - **A** — inputs that must NOT produce a specific value (false-positive corpus)
   - **B** — inputs that MUST produce a specific value (true positives)
   - **C** — neutral / null cases
   - **D** — explicit / direct signal cases
   Aim for 8–16 cases minimum, sourced from failure corpus and real interaction logs.

6. Run: `bun eval/run.ts <name> --providers haiku --no-cache`

### Adding a v2 candidate

1. Copy `v1-current.json` → `v2-<description>.json` in `eval/<name>/prompts/`.
2. Add the new file to `prompts:` in `promptfoo.yaml`.
3. Run the eval and iterate on the prompt text until failing cases pass without breaking passing ones.

## Shared infrastructure

Do not modify these files unless changing behaviour for all evals:

| File | Purpose |
|------|---------|
| `eval/lib/parse-output.js` | Extracts JSON from string or object output |
| `eval/lib/assert.js` | `makeCheck` factory for field-level assertions |
| `eval/run.ts` | Runner — accepts `<name>`, resolves config, sets cwd for logs |
| `eval/logs/` | Gitignored; promptfoo writes error/debug logs here |

After any change to shared infrastructure, run `bun eval/run.ts sentiment --no-cache` to confirm no regressions.

## Output format

Report results as:
- Pass rate per prompt (e.g. "v1: 17/19 (89%), v2: 19/19 (100%)")
- Which test IDs failed and why (field value vs expected)
- Recommendation: crystallize v2, iterate further, or v1 holds

## When to use / Do NOT use

**Use when:**
- A prompt constant in `src/` changed and regression check is needed
- Adding a new classification prompt that needs labeled test coverage
- Comparing two prompt variants before committing one

**Do NOT use when:**
- The prompt has no eval directory yet and the user hasn't asked to scaffold one (ask first)
- Running evals for non-PAL projects (this skill is repo-specific)
