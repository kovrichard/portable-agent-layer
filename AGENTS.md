# AGENTS.md

Working notes for any AI agent contributing to this repository.

> User-facing intro lives in `README.md`. This file is for agents — start here.

## What is PAL

The Portable Agent Layer is cross-platform, cross-agent infrastructure for carrying personal AI context (TELOS, memory, skills, hooks) between machines and between AI runtimes (Claude Code, opencode, Cursor, Codex). It ships as a CLI (`pal`) plus a curated set of skills, hooks, and tooling that targets each agent's native config format.

Two layers carry most of the work:

- **`src/`** — the `pal` CLI (entrypoint `src/cli/index.ts`), the runtime hooks PAL installs into other agents (`src/hooks/`, shared helpers in `src/hooks/lib/`), per-agent install/uninstall logic (`src/targets/<agent>/`), and the tools an agent invokes at runtime (`src/tools/`).
- **`assets/skills/<name>/`** — the skills PAL ships. Each is self-contained: `SKILL.md` (the spec YOU follow), a human-facing `README.md`, usually `tools/*.ts`, and optional `template/`, `demo/`, `theme-base/`, `vendor/`.

One directory is easy to misread: `.agents/` holds *this repo's* dev gates and is not the PAL runtime hooks in `src/hooks/`.

When PAL is installed, `~/.pal/skills/<name>/` may be a directory junction back to `assets/skills/<name>/`. Edit at the repo source path, never the `~/.pal/...` path — the junction can mask whether you're touching tracked files.

## Running and testing

This repo uses [Bun](https://bun.sh) ≥ 1.4.0 — never `npm`, `pnpm`, or `node`.

```bash
bun install                                     # frozen on CI
bun test                                        # full suite
bun test test/cli.test.ts                       # one file
bun test --test-name-pattern "scaffolds telos"  # one test by name
```

Run the CLI against a sandboxed home with `PAL_HOME=./.test-home bun src/cli/index.ts cli init`. `.test-home/` is wiped at the start of `bun test test/cli.test.ts`.

Each gate, its script, and its wrapper in `.agents/hooks/`:

| Script                     | What it does                       | Wrapper           |
| -------------------------- | ---------------------------------- | ----------------- |
| `bun run check`            | Biome lint + format (read-only)    | `check.ts`        |
| `bun run check-write`      | Biome `--write`, naming what it rewrote | (manual)     |
| `bun run type-check`       | `tsc --noEmit`                     | `type-check.ts`   |
| `bun run knip`             | Dead-code / unused-deps scan       | `knip.ts`         |
| `bun run jscpd`            | Copy-paste detection               | `jscpd.ts`        |
| `bun run klint`            | Architecture rules                 | `klint.ts`        |
| `bun run madge`            | Circular-import detection          | `madge.ts`        |
| `bun run lf`               | CRLF guard on tracked files        | `lf.ts`           |
| `bun run lf:fix`           | Converts offenders to LF           | (manual)          |
| `bun run secretlint`       | Secret scanning                    | `secretlint.ts`   |
| `bun run test`             | Bun test runner (randomized)       | (pre-push and CI) |
| `bun run test:mutate:diff` | Stryker on the changed lines       | (CI on PRs)       |

## The `.agents/hooks/` system

Every wrapper above is wired into the Stop / session-end event of each agent configured here. Each wrapper is a thin call into `run-hook.ts`, which does the subprocess plumbing and skips the whole chain when `git status` is empty — so a conversational turn that changed nothing costs a single git call. A failing gate makes `run-hook.ts` exit 2, which the agent treats as a blocked session-end: it must fix the underlying issue before it can stop.

| Agent       | Config file                 | Event          |
| ----------- | --------------------------- | -------------- |
| Claude Code | `.claude/settings.json`     | `Stop`         |
| Cursor      | `.cursor/hooks.json`        | `stop`         |
| Codex       | `.codex/hooks.json`         | `Stop`         |
| Copilot     | `.github/hooks/gates.json`  | `agentStop`    |
| opencode    | `.opencode/plugins/lint.ts` | `session.idle` |

To add a gate: a script in `package.json`, a wrapper in `.agents/hooks/`, and an entry in each agent config above.

Git hooks in `.husky/` enforce the same gates independently of any agent: `pre-commit` runs lint-staged plus every gate except the test suite, `pre-push` runs `bun run test`, and `commit-msg` runs commitlint — so commit messages must be conventional commits.

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
