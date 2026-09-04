# AGENTS.md

Working notes for any AI agent contributing to this repository.

> User-facing intro lives in `README.md`. This file is for agents — start here.

## What is PAL

The Portable Agent Layer is a cross-platform, cross-agent infrastructure for carrying personal AI context (TELOS, memory, skills, hooks) between machines and between AI runtimes (Claude Code, opencode, Cursor, Codex). It ships as a CLI (`pal`) plus a curated set of skills, hooks, and tooling that targets each agent's native config format.

The repo has two layers you'll spend most of your time in:

- **`src/`** — the CLI, the runtime hooks PAL itself installs (security validators, session-end handlers, etc.), and tools for managing memory, telos, threads, wisdom frames, opinion tracking, etc.
- **`assets/skills/<name>/`** — the skills PAL ships. Each skill is a self-contained folder with a `SKILL.md`, often a `tools/` subdir with TypeScript scripts, plus optional `template/`, `demo/`, and `theme-base/` subdirs (e.g. for the presentation skill).

When PAL is installed, `~/.pal/skills/<name>/` may be a directory junction back to `assets/skills/<name>/`. Edit at the repo source path, never the `~/.pal/...` path — the junction can mask whether you're touching tracked files.

## Repository layout

```
.
├── .agents/                  # this repo's dev hooks (not the PAL runtime hooks)
│   ├── hooks/                # bun-run TypeScript hooks called by Stop events
│   └── scripts/              # helpers the hooks and package scripts call
├── .claude/                  # project-level Claude Code config (committed)
│   └── settings.json         # Stop hook + permission allowlist
├── .codex/                   # project-level Codex config (committed)
│   └── hooks.json            # Stop event → same hook chain, --codex output
├── .cursor/                  # project-level Cursor config (committed)
│   └── hooks.json            # stop event → same hook chain
├── .github/
│   ├── hooks/gates.json      # Copilot agentStop → same hook chain
│   └── workflows/            # ci + mutation pipelines
├── .opencode/                # opencode plugin folder (committed)
│   └── plugins/lint.ts       # session.idle handler → same hook chain
├── .husky/                   # pre-commit / pre-push hooks (lint-staged + biome)
├── assets/
│   └── skills/               # all PAL-shipped skills
│       └── <name>/
│           ├── SKILL.md      # agent-facing skill spec (instructions YOU follow)
│           ├── README.md     # human-facing skill blurb
│           ├── tools/*.ts    # bun-run scripts the skill exposes
│           ├── template/     # scaffolding for new artefacts (optional)
│           ├── demo/         # showcase content (optional)
│           ├── theme-base/   # brand-neutral assets (presentation skill)
│           └── vendor/       # vendored 3rd-party libs (presentation skill)
├── src/
│   ├── cli/                  # `pal` CLI — entrypoint at src/cli/index.ts
│   │   ├── setup-identity.ts
│   │   └── setup-telos.ts
│   ├── hooks/                # PAL runtime hooks (installed into target agents)
│   │   └── lib/              # shared hook helpers; semi-static.ts is the single registry for context sources
│   ├── targets/              # per-agent install/uninstall logic
│   │   ├── claude/
│   │   ├── opencode/
│   │   ├── cursor/
│   │   ├── copilot/
│   │   └── lib.ts
│   └── tools/                # tools the agent invokes at runtime
│       ├── agent/            # synthesize, thread, wisdom-frame, analyze
│       ├── self-model.ts
│       ├── relationship-reflect.ts
│       └── token-cost.ts
├── test/                     # bun test files; one per concern
├── biome.json                # lint + format config
├── knip.json                 # dead-code/dep checker config
├── package.json
├── AGENTS.md                 # ← you are here
├── CLAUDE.md                 # symlink → AGENTS.md
└── README.md                 # user-facing intro
```

## Running and testing

This repo uses [Bun](https://bun.sh) ≥ 1.4.0 — never `npm`, `pnpm`, or `node`.

```bash
# install deps (frozen on CI)
bun install

# run the full test suite (currently ~26 files, ~304 tests)
bun test

# run a single test file
bun test test/cli.test.ts
bun test test/doctor.test.ts

# run one test by name pattern
bun test --test-name-pattern "scaffolds telos"
```

Each gate script and its agent-hook wrapper:

| Script                | What it does                             | Hook wrapper                   |
| --------------------- | ---------------------------------------- | ------------------------------ |
| `bun run check`       | Biome lint + format (read-only)          | `.agents/hooks/check.ts`       |
| `bun run check-write` | Biome lint + format with `--write`       | (manual, not in stop chain)    |
| `bun run type-check`  | `tsc --noEmit`                           | `.agents/hooks/type-check.ts`  |
| `bun run knip`        | Knip dead-code / unused-deps scan        | `.agents/hooks/knip.ts`        |
| `bun run jscpd`       | Copy-paste detection                     | `.agents/hooks/jscpd.ts`       |
| `bun run klint`       | Architecture rules                       | `.agents/hooks/klint.ts`       |
| `bun run madge`       | Circular-import detection                | `.agents/hooks/madge.ts`       |
| `bun run lf`          | CRLF guard on tracked files              | `.agents/hooks/lf.ts`          |
| `bun run lf:fix`      | Converts offenders to LF                 | (manual, not in stop chain)    |
| `bun run secretlint`  | Secret scanning                          | `.agents/hooks/secretlint.ts`  |
| `bun run test`        | Bun test runner (randomized)             | (pre-push and CI; not in stop) |
| `bun run test:mutate:diff` | Stryker on the changed lines        | (CI on pull requests)          |

Run the CLI itself in dev mode against a sandboxed home:

```bash
PAL_HOME=./.test-home bun src/cli/index.ts cli help
PAL_HOME=./.test-home bun src/cli/index.ts cli init
```

`.test-home/` is wiped at the start of `bun test test/cli.test.ts`.

## The `.agents/hooks/` system

Every gate above is wired into the **Stop / session-end** event of each agent that has a config file in this repo. When an agent stops generating, it runs:

```
bun .agents/hooks/check.ts
bun .agents/hooks/type-check.ts
bun .agents/hooks/knip.ts
bun .agents/hooks/jscpd.ts
bun .agents/hooks/klint.ts
bun .agents/hooks/secretlint.ts
bun .agents/hooks/madge.ts
bun .agents/hooks/lf.ts
```

`run-hook.ts` skips the whole chain when `git status` is empty, so a conversational
turn that changed nothing costs a single git call.

If any exits non-zero, the agent treats the session-end as blocked and the failure output is surfaced — the agent must fix the underlying issue before it can stop.

Per-agent wiring:

| Agent       | Config file                  | Event used     |
| ----------- | ---------------------------- | -------------- |
| Claude Code | `.claude/settings.json`      | `Stop`         |
| Cursor      | `.cursor/hooks.json`         | `stop`         |
| Codex       | `.codex/hooks.json`          | `Stop`         |
| Copilot     | `.github/hooks/gates.json`   | `agentStop`    |
| opencode    | `.opencode/plugins/lint.ts`  | `session.idle` |

Each individual hook file is a thin wrapper:

```ts
// .agents/hooks/check.ts
import { runHook } from "./run-hook";
const exitCode = runHook(["bun", "run", "check"]);
process.exit(exitCode);
```

`run-hook.ts` does the actual subprocess plumbing (capture stdout+stderr, return JSON envelope on success, exit 2 on failure so the agent knows to block).

To add a new gate (say, a security audit), add a script to `package.json`, a wrapper to `.agents/hooks/<name>.ts`, and append it to the three agent configs.

## Coding rules

These are project-wide. Every PR follows them; agents enforce them as they write code.

### File edits go through the edit tools, never through the shell

Change files with the `Edit` / `Write` tools (or your agent's equivalent). Do not
edit files with `sed -i`, `perl -i`, `patch`, an interpreter heredoc, or a shell
redirect into a tracked file. Reading, searching and running commands through the
shell is unchanged — this rule is about writes only.

Two reasons, and the second is the one that matters here:

- A shell write is opaque. `sed -i` and a `python3` heredoc leave no record of what
  the file looked like before, so nothing downstream can say what changed. An `Edit`
  call carries `old_string` and `new_string`, which is a before/after state for free.
  This repo is building an action ledger (ISC-3) that depends on exactly that.
- On Claude Code these are not equally scrutinised. Working-directory edits are
  auto-approved, while every shell command goes to the auto-mode classifier — so a
  shell write is the slower path *and* the invisible one.

`.claude/settings.json` denies the unambiguous in-place editors (`sed -i`, `perl -i`,
`patch`, `truncate`, `dd`, `ed`). That list is a backstop, not the rule — it cannot
catch an interpreter heredoc or a redirect without also blocking legitimate reads and
build output, so the rule above is what actually governs.

### Other house rules (already enforced by tooling)

- No assignment in expressions (e.g. `while ((m = re.exec(s)) !== null)` — Biome catches it; use `Array.from(s.matchAll(re), ...)` or `for (const m of s.matchAll(re))`).
- Bun stdlib APIs over Node-style polyfills where both exist.
- No personal information (usernames, real names, employer/project codenames, absolute home paths) in any file under `assets/skills/` or `src/`. Personal context belongs in private memory only — see `.agents/skills/author-pal-skill/SKILL.md` for the rule.
- One skill = one job. If a skill needs branching like "for case A do X, for case B do Y," it's two skills.

## Context injection architecture

PAL uses a 3-tier system to keep the hook's dynamic output small while ensuring each agent receives full context natively.

| Tier | What | How | Written |
| ---- | ---- | --- | ------- |
| **1 — Operational** | CLAUDE.md / AGENTS.md — identity, modes, routing | Loaded natively by each agent at startup | On install / AGENTS.md change |
| **2 — Semi-static** | Self-model, wisdom, opinions, synthesis, failures, steering | `@imports` (Claude Code), `instructions[]` (opencode), `.mdc` rules (Cursor), `.instructions.md` (Copilot) | Written at session stop by `writeContextDigests()` |
| **3 — Dynamic** | Handoff, session intelligence, threads, relationship notes, project history | Hook stdout via `LoadContext` → `buildSystemReminder()` | Injected fresh each session |

**Single registry.** All semi-static sources are defined in `src/hooks/lib/semi-static.ts` via `getSemiStaticSources()`. Adding one entry there propagates automatically to: CLAUDE.md `@imports`, opencode `instructions[]`, Cursor `.mdc` filenames, Copilot `.instructions.md` filenames, and the session-stop digest writer. No other files need touching.

## Common workflows

| Task | Where to look |
| ---- | ------------- |
| Add a new skill (shared, ships in repo) | `.agents/skills/author-pal-skill/SKILL.md` — repo-only scaffolder (symlinked into `.claude/skills/` and `.cursor/skills/`, like `klint-rules`) that writes into `assets/skills/` with the shared-skill rules baked in. (The shipped `create-skill` is the downstream counterpart: it scaffolds a user's *private* skill into `~/.pal/skills/`.) |
| Add a new agent target | `src/targets/<agent>/install.ts` + `uninstall.ts`; register in `src/cli/index.ts`. |
| Add a new tool | `src/tools/<area>/<tool>.ts` with `import.meta.main` guard so it stays testable. |
| Add a runtime PAL hook | `src/hooks/<name>.ts`; the install routine in `src/targets/*/install.ts` wires it into the target agent's config. |
| Add a semi-static context source | Add one entry to `getSemiStaticSources()` in `src/hooks/lib/semi-static.ts`. That's it. |
| Run only doctor on a deck | `bun assets/skills/presentation/tools/doctor.ts <deck-dir>` |
