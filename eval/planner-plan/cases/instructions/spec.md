# Roles follow the repo's and the user's instructions

## Goal

`role.mjs` runs every role with `--setting-sources ""`. That keeps the user's hooks out, which is what the spike needed: RtkWrap rewrote `git diff` until the allowlist denied it, and SessionStart injected another project's context. But it also drops every CLAUDE.md. The #137 transcripts show no CLAUDE.md content, and no role read one. So the roles never see the repo's coding rules ("no comments", "edit tools only", the Bun rules) or the user's own instructions and steering, and haiku writes code without the rules the repo is reviewed against.

After this change, every role gets two sets of instructions appended to its system prompt:

- **the repo's instructions:** its `CLAUDE.md`;
- **the user's instructions:** `~/.claude/CLAUDE.md`.

In both, `@path` imports are resolved the way Claude Code resolves them. Hooks, settings and MCP servers stay off.

The plugin stays independent. Everything above is plain Claude Code (a repo `CLAUDE.md`, the user's `~/.claude/CLAUDE.md`, `@` imports), with nothing PAL-specific. A user without PAL gets their own CLAUDE.md files, or none, and the factory works the same either way. Each set can be switched off in config.

## Acceptance criteria

### Instructions reach the roles

1. `role.mjs` builds one instructions text per run and passes it with `--append-system-prompt-file <file>`, written to the task folder. The text contains, in this order:
   - the user's `~/.claude/CLAUDE.md`, resolved;
   - the repo's `CLAUDE.md` from the worktree root, resolved.

   Each part is headed by the path it came from. A file that doesn't exist is skipped, and when neither exists the flag is not passed. A test pins the flag and the order.
2. `@path` import resolution:
   - It matches Claude Code's syntax: an `@path` that starts a line is replaced by that file's content. The path is relative to the importing file's folder, with `~/` expanded.
   - It recurses up to 5 levels.
   - An `@` inside inline code or a code block is left alone.
   - An import that can't be read is left as written, and the run records an `instructions_import_missing` event with the path.

   Tests cover each case.
3. The repo part is read from the user's checkout at `prepare`, together with the frozen `config` (#136), not from the worktree. A role that edits the worktree's `CLAUDE.md` therefore doesn't change what the next role is told. A test covers the edit case.
4. `--setting-sources ""` stays. No user or project hook, setting or MCP server reaches a role. The existing argument test still pins this.

### The plugin works on its own

5. Config switches, both on by default:
   - `.dark-factory.json` `"repoInstructions": false` skips the repo part;
   - `~/.dark-factory/config.json` `"userInstructions": false` skips the user part. This file is new and optional, and a missing file means the defaults.

   Tests cover both switches and the missing file.
6. Nothing in `assets/plugins/dark-factory/` refers to PAL, `~/.pal` or `pal cli`. A test greps the plugin folder for `.pal/` and `pal cli`.
7. A run with no `~/.claude/CLAUDE.md` and no repo `CLAUDE.md` runs as it does today. The suite's existing fake-`claude` run covers this, with `HOME` pointed at an empty folder.
8. The plugin README says what the roles receive, how to switch each part off, and that hooks never run in a role.

### Proof

9. One real run, recorded in the PR body by the tester: a role on this repo, on this machine, whose transcript shows that:
   - the appended prompt holds both parts;
   - the role still ends with `StructuredOutput`;
   - no hook fired.

   It also reports whether the role followed the user's instructions in a way that got in the way of its job: a mode header in the structured output, a question asked instead of `question` being set, a denied `pal cli` call. It quotes each case it found.
10. All gates in `.dark-factory.json` pass. Commits are conventional: `test(dark-factory): …` for the tests and `feat(dark-factory): …` for the code. One pull request into `canary`.

## Out of scope

- Turning any hook back on in a role.
- Writing factory-specific instructions into PAL, or changing PAL's install.
- `AGENTS.md` or other agents' instruction files. In this repo `CLAUDE.md` is a symlink to `AGENTS.md`, so reading `CLAUDE.md` covers it.
- Changing role prompts to fit the user's instructions together with their own. Criterion 9 reports conflicts, and a follow-up fixes them.

## Decisions

- The spec is approved: build it. The user typed "build it" (2026-10-20, 11:55).

- Specced on the user's "spec it but ensure the plugin can be used independently if someone wants to" (2026-10-20, 11:51).
- User-level content is included on the user's call: leaving out the steering rules and the Algorithm weakens the factory. Hooks stay off because of verified failures: RtkWrap, a foreign SessionStart, and a Stop gate a role can't satisfy.
- The user part is the user's own `~/.claude/CLAUDE.md`, not a list of PAL files, so the plugin has no PAL dependency. For the user that file imports the self-model, opinions, failures digest and steering rules, and it names the Algorithm.
- Category `feature`. It's new behaviour, and the run exercises the planner and the tester on real `claude` for the first time.
