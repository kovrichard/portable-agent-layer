# dark-factory

A software factory of agents for Claude Code. You talk to the product owner; the factory turns your request into a pull request that is green and reviewed before you see it.

## Install

Without PAL:

```
/plugin marketplace add kovrichard/portable-agent-layer
/plugin install dark-factory@pal
```

With PAL, it is installed for you.

## Requirements

- `node`: runs the factory's scripts.
- `git`: worktrees, branches and pushes.
- `gh`, signed in with `gh auth login`: opens the pull request and reads its CI checks.
- `bash`: runs the gate and the notify commands. On Windows it comes with Git for Windows.
- `claude`, signed in: every role runs as a headless `claude -p` session.

The PO checks for these before it takes a request, and every build checks again before it starts.

## Use

Run `/dark-factory:po` and say what you want. The PO writes a spec with acceptance criteria, shows it to you, and starts the build once you say go. You hear back when the pull request is ready, or when the factory needs an answer only you can give.

The build is a plain Node program, `scripts/build.mjs`, that the PO starts in the background. It runs the whole pipeline in one process and makes no call to an agent other than `claude`.

### From a terminal or cron

```
node <plugin folder>/scripts/build.mjs <task-id>
```

Inside Claude Code the plugin folder is `${CLAUDE_PLUGIN_ROOT}`.

- It needs `claude` and `gh` signed in. Set `DARK_FACTORY_HOME` when the default `~/.dark-factory` isn't the home.
- It prints one JSON line, `{task, status, message, pr}`.
- It exits 0 for ready, 1 for stuck and 3 for waiting.
- A rerun after an answer goes in the spec's **Decisions** section, and the rerun continues the task.

## Roles

| Role | Model | Job |
| --- | --- | --- |
| PO | Opus | Writes the spec, answers the other roles, asks you only what changes the product |
| Architect | Opus | Designs large changes |
| Planner | Opus | Writes a plan detailed enough for a small model |
| Test writer | Sonnet | Writes failing tests for every acceptance criterion |
| Code writer | Haiku | Implements the plan |
| Debugger | Opus | Reproduces bugs, fixes what the code writer could not |
| Reviewer | Sonnet | Reviews the diff against the spec |
| Tester | Sonnet | Checks the criteria in the running app |
| Coach | Opus | Studies every ready or stuck run and proposes general rules for the role prompts |
| Gate | code | Runs your checks; its exit code is the verdict |

Not every task runs every role. The PO picks a category, and code maps it to roles:

| Category | Before code | After code |
| --- | --- | --- |
| `small` | none | reviewer |
| `bug` | debugger, test writer | reviewer |
| `feature` | planner, test writer | reviewer, tester |
| `big-feature` | architect, planner, test writer | reviewer, tester |
| `refactor` | planner | reviewer |

A diff that touches the paths in `uiPaths` always adds the tester.

When the gate fails, the code writer gets two attempts on Haiku, then two on Sonnet, then the debugger gets two on Opus. After that the task is marked stuck and you are told what was tried. Review findings get two fix rounds, CI failures three.

## Repo config

Each repository the factory works on has a `.dark-factory.json` at its root:

```json
{
  "baseBranch": "main",
  "prepare": "bun install",
  "gate": [
    { "name": "types", "run": "bun run type-check" },
    { "name": "lint", "run": "bun run lint" },
    { "name": "tests", "run": "bun run test" }
  ],
  "uiPaths": ["src/app/", "src/components/"],
  "appStart": "docker compose up -d && bun run dev"
}
```

The categories with a test writer (`bug`, `feature` and `big-feature`) need a gate check named exactly `tests`. The build runs it right after the test writer, and the task is stuck when no test fails.

## Notifications

Set `DARK_FACTORY_NOTIFY` to a shell command. It receives the message on stdin, with `DARK_FACTORY_TASK` and `DARK_FACTORY_KIND` (`ready`, `waiting` or `stuck`) in its environment.

## Measuring

The factory keeps its tasks, worktrees and event log in `$DARK_FACTORY_HOME`, which defaults to `~/.dark-factory` on every machine. A factory task cannot continue on another machine, so its history stays where it ran.

Every step appends one event to `$DARK_FACTORY_HOME/events.jsonl`, and the events of a task are also appended to `tasks/<task>/events.jsonl`, with its `run_finished` line. A role's `role_finished` event carries its `sessionId`, the name of its transcript. `node scripts/stats.mjs` counts, from those events alone: tasks by category, outcomes, gate failures by check and by role, the code writer's first-try pass rate, escalations, CI results, review rounds, questions to you, and roles added by the diff check.

Every role run appends `role_finished` with its cost and tokens, and the red-test proof appends `tests_red` with the exit code and the failing count. Every build appends `run_finished` with the outcome, the total `costUsd`, the total tokens, the number of role runs and `wallMs`. `node scripts/task.mjs show <id>` prints the task with its latest step.

## Coach

After a run ends `ready` or `stuck`, the build starts the coach in a detached process, so nothing waits on it. It writes `coach_started`, then `coach_finished` or `coach_failed`.

The coach reads the spec, the artifacts, the task's events, the diff of the run, the transcripts named by `role_finished`'s `transcriptPath`, and the commits you pushed to a merged PR after the factory's last push (`pushed` carries `head`).

Its findings live in `$DARK_FACTORY_HOME/coach/findings.jsonl`. Each finding has an `id`, a `role`, a `class`, a `rule`, a `severity`, a `metric`, its `evidence` and a `status`: `pending`, `rejected`, or `approved` once a task is created for it.

The coach's result has a `reviewed` list with one verdict per transcript and per correction commit: its `source` (the transcript path or the commit sha), a `verdict` of `finding` or `clean`, the `class` for a finding, and a one-sentence `reason`. `coach.mjs` checks coverage in code: an input with no item, or a `finding` whose class is neither among the run's findings nor the class of a pending finding, is missing. Missing inputs make it resume the same session once (`--resume`), listing them, and the second result's verdicts and findings are merged with the first's. Inputs still missing are recorded as `coach_incomplete`; the findings returned are stored anyway, and a correction without a verdict is not marked given, so the next run gets it again. `coach_finished` carries `reviewed` and `expected`: the number of inputs with a verdict, and the number of inputs.

A deterministic generality check drops a rule that names a path, basename or identifier the run's diff changed, and records it as `coach_rule_rejected`. An added function or variable name only counts when it is camelCase, contains `_` or a digit, and has at least 3 characters; a plain lowercase name such as `parse` or `slug` passes, because it would match ordinary words in a rule.

The coach runs with `--add-dir` for the factory home, the transcripts folder and the plugin directory, so it can read the transcripts and the role prompts. Concurrent coach runs take a lock on `coach/findings.lock` while they update the findings, and a task whose merged PR has no later commits is recorded as `coach_checked` and not queried again.

`node scripts/coach.mjs` has these commands:

- `run <task-id>` runs the coach by hand.
- `list` lists pending findings by role; `list --applied` reports each merged rule's metric before and after its merge.
- `show <id>` prints one finding.
- `reject <id> "<reason>"` rejects a finding; its class does not come back.
- `approve <id> [--repo <path>]` creates a `small` task for the plugin repo with a generated spec. Set `coach.repo` in `config.json` to skip `--repo`.

Approving only creates the task. Your go builds it, and the rule lands through a PR.

## Instructions

Every role gets your instructions appended to its system prompt: first the user's `~/.claude/CLAUDE.md`, then the repo's `CLAUDE.md`, each headed by its path. An `@path` line in either file imports that file, as Claude Code does: the path is relative to the file that contains the line, `~/` is your home folder, imports nest up to 5 levels, and lines inside code blocks are never imports. A file that doesn't exist is skipped. An import that can't be read stays as written in the instructions and is logged as an `instructions_import_missing` event.

The repo's `CLAUDE.md` is read from your checkout when the task starts, so a role that edits it in the worktree doesn't change what the later roles are told.

- `"repoInstructions": false` in `.dark-factory.json` leaves out the repo's `CLAUDE.md`.
- `"userInstructions": false` in `$DARK_FACTORY_HOME/config.json` (`~/.dark-factory/config.json`, optional; a missing file means both parts are on) leaves out your `~/.claude/CLAUDE.md`.

Hooks never run in a role, and neither do your settings or MCP servers.

## Permissions

- Roles run isolated: `--setting-sources ""`, the plugin from `--plugin-dir`, and their own tool policy from `roles.mjs`, so user hooks and settings don't reach them; only the CLAUDE.md instructions above do.
- The PO session only needs `"Bash(node *dark-factory*/scripts/*)"`, for example in `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(node *dark-factory*/scripts/*)"]
  }
}
```
