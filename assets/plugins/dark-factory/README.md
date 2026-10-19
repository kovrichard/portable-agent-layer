# dark-factory

A software factory of agents for Claude Code. You talk to the product owner; the factory turns your request into a pull request that is green and reviewed before you see it.

## Install

Without PAL:

```
/plugin marketplace add kovrichard/portable-agent-layer
/plugin install dark-factory@pal
```

With PAL, it is installed for you.

## Use

Run `/dark-factory:po` and say what you want. The PO writes a spec with acceptance criteria, shows it to you, and starts the build once you say go. You hear back when the pull request is ready, or when the factory needs an answer only you can give.

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

## Notifications

Set `DARK_FACTORY_NOTIFY` to a shell command. It receives the message on stdin, with `DARK_FACTORY_TASK` and `DARK_FACTORY_KIND` (`ready`, `waiting` or `stuck`) in its environment.

## Measuring

Every step appends one event to `~/.dark-factory/events.jsonl`. `node scripts/stats.mjs` counts, from those events alone: tasks by category, outcomes, gate failures by check and by role, the code writer's first-try pass rate, escalations, CI results, review rounds, questions to you, and roles added by the diff check.

## Permissions

The build runs git, gh and your gate commands without you watching. Allow them before the first run, for example in `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(node *dark-factory*/scripts/*)", "Bash(git *)", "Bash(gh pr *)", "Bash(gh run *)"]
  }
}
```
