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

The factory keeps its tasks, worktrees and event log in `$DARK_FACTORY_HOME`, which defaults to `~/.dark-factory` on every machine. `pal cli export` does not carry them: a factory task cannot continue on another machine, so its history stays where it ran.

Every step appends one event to `$DARK_FACTORY_HOME/events.jsonl`. `node scripts/stats.mjs` counts, from those events alone: tasks by category, outcomes, gate failures by check and by role, the code writer's first-try pass rate, escalations, CI results, review rounds, questions to you, and roles added by the diff check.

Every role run appends `role_finished` with its cost and tokens, and the red-test proof appends `tests_red` with the exit code and the failing count. Every build appends `run_finished` with the outcome, the total `costUsd`, the total tokens, the number of role runs and `wallMs`. `node scripts/task.mjs show <id>` prints the task with its latest step.

## Permissions

- Roles run isolated: `--setting-sources ""`, the plugin from `--plugin-dir`, and their own tool policy from `roles.mjs`, so user hooks and settings don't reach them.
- The PO session only needs `"Bash(node *dark-factory*/scripts/*)"`, for example in `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(node *dark-factory*/scripts/*)"]
  }
}
```
