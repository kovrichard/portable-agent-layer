# dark-factory

A software factory of agents for Claude Code. You talk to the product owner; the factory turns your request into a pull request that is green and reviewed before you see it.

## Install

Without PAL:

```
/plugin marketplace add kovrichard/portable-agent-layer
/plugin install dark-factory@pal
```

With PAL, the marketplace is registered but the plugin starts disabled; turn it on with `/plugin enable dark-factory@pal`.

## Requirements

- `node`: runs the factory's scripts.
- `git`: worktrees, branches and pushes.
- `gh`, signed in with `gh auth login`: opens the pull request and reads its CI checks.
- `bash`: runs the gate and the notify commands. On Windows it comes with Git for Windows.
- `claude`, signed in: every role runs as a headless `claude -p` session.

The PO checks for these before it takes a request, and every build checks again before it starts.

## Use

Run `/dark-factory:po` and say what you want. The PO reads the code first and asks you, in one batch with a recommended answer for each, only what the code and what it knows about you cannot settle. It writes a spec with acceptance criteria and starts the build: your request is the go, the factory goes as far as an open pull request, and merging stays with you. Ask to see the spec first if you want to. You hear back when the pull request is ready, or, rarely, when the factory needs an answer only you can give.

The build is a plain Node program, `scripts/build.mjs`, that the PO starts in the background. The command starts the pipeline in a detached worker process (on Linux through `systemd-run --user --scope` when available, so it has its own cgroup scope) and waits for it; the build keeps running if the session ends. It still makes no call to an agent other than `claude`.

### From a terminal or cron

```
node <plugin folder>/scripts/build.mjs <task-id>
```

Inside Claude Code the plugin folder is `${CLAUDE_PLUGIN_ROOT}`.

- It needs `claude` and `gh` signed in. Set `DARK_FACTORY_HOME` when the default `~/.dark-factory` isn't the home.
- It prints one JSON line, `{task, status, message, pr}`.
- It exits 0 for ready, 1 for stuck and 3 for waiting.
- A rerun after an answer goes in the spec's **Decisions** section, and the rerun continues the task.
- The worker writes its output to `tasks/<id>/build.log` and its outcome to `tasks/<id>/result.json`; `tasks/<id>/build.lock` holds its pid.
- Running the same command while the build runs waits for it and prints its result; running it after the worker died resumes it.
- A rerun on a clean worktree skips the code, review and tester steps already finished at its current commit.
- `node scripts/task.mjs show <id>` tells where it is.

### With subagents

`/dark-factory:build-with-agents <task-id>` runs a written task through the same pipeline with each role as a `dark-factory:<role>` subagent of the session instead of a `claude -p` process. The session has to start in the task's worktree, because its subagents work in the folder it started in and share it, and without the repo's Claude Code hooks. `prepare` prints the command that starts it as `po`:

```
node <plugin folder>/scripts/task.mjs prepare <task-id>
```

Run its `po` value: `cd <worktree> && claude --model <the PO's model> --setting-sources local [--settings <task folder>/role-settings.json] --plugin-dir <plugin folder> "/dark-factory:build-with-agents <task-id>"`. The model is the one in `agents/po.md`, so the session does not depend on your own default model. For an unattended run, use its `poUnattended` value: the same session with `-p`, `--permission-mode dontAsk`, the task folder and the plugin folder as `--add-dir`, and the PO's tools as `--allowedTools`. It exits when the build ends. A `prepare` on a `running` task whose run is still open starts no new run, so the PO's own `prepare` at step 2 does not restart the run it is in.

It is the other half of an A/B against `build.mjs` (ISC-97): every pass or fail still comes from the step commands below, `gate.mjs`, `ship.mjs` and `ci-wait.mjs`. Each role gets the same fixed instructions as in `build.mjs`, and the session records every prompt it hands a subagent with `task.mjs handover <task-id> <role> <reason> <model>`, the prompt on stdin. That writes the same `handover` and `role_run` events `build.mjs` writes, with `from: "po"`, so `stats.mjs` counts both sides alike. The session records each review round with `task.mjs review <task-id> <round> <findings>` and the tester's result with `task.mjs test <task-id> <unmet>`. The plugin's `SubagentStop` hook (`scripts/subagent-stop.mjs`) writes `role_finished` for every `dark-factory:` subagent that works in a task's worktree: its tokens and turns from the subagent's transcript, and its last message saved as the reply. A subagent continued with `SendMessage` stops again with its whole transcript, so a later stop of the same `agentId` in the task counts only the messages after that agent's previous `role_finished`: its tokens, turns, tool calls, cost and duration are those of the new messages. Its `costUsd` is priced from the transcript with the plugin's price table, `scripts/prices.mjs`, which a test keeps equal to PAL's: each message at its own model's rates, cache writes at the 5-minute or 1-hour rate (`cacheCreation5mTokens`, `cacheCreation1hTokens`; `cacheCreationTokens` stays the total), and a `claude-haiku-5-5` message whose prompt is over 100,000 tokens at 5 times the rates. It is `null` when a message's model is not in the table. The event also carries `toolCalls`. At the run's final status `task.mjs` appends, before `run_finished`, one `role_finished` with `role: "po"` for each PO session of the run: its transcript is `<dir>/<sessionId>.jsonl`, next to the `<sessionId>/subagents` folder the subagents' `transcriptPath` points into, and only its messages from the run's `task_started` on count. So `run_finished` totals the PO's cost and tokens with the subagents'. The PO session's messages after `run_finished` (its final report) are not in that total: the plugin's `SessionEnd` hook (`scripts/session-end.mjs`) appends one more `role_finished` with `role: "po"` and `afterRunFinished: true`, counting only the session's assistant messages after the last `po` event of the run for that session. `stats.mjs` folds it into the run it follows, so the run's cost and `estimateFor` include it. Inside a `build.mjs` role (`DARK_FACTORY_ROLE` set) the hook writes nothing, because `build.mjs` logs that run itself.

### One step at a time

A PO session can run the build's deterministic checks one at a time with `node <plugin folder>/scripts/step.mjs <command> <task-id>`. Each command uses the build's own functions, reads the worktree, base and gate from `task.json`, and prints one JSON line. It exits 0 when the check passes and 1 when it fails or the task or its worktree is missing; a missing command or task id prints the usage line and exits 2.

- `baseline` runs the tests and records `tests_baseline`. It prints `{"failing": N}`, or `{"failing": null, "message": "…"}` when the run reports no count.
- `prove-red` checks that the new tests fail more than at the latest baseline and records `tests_red`. It prints `{"ok": true}`, or `{"ok": false, "message": "…"}`.
- `snapshot` records the worktree's `tree_snapshot`. It prints `{"tree": "<sha>"}`.
- `test-edits` lists the test files changed or deleted since the latest `tree_snapshot`, leaving out those the spec lists under `## Test files this task changes`, and records nothing. It prints `{"files": []}` when none changed, or `{"files": [...]}` with exit 1.
- `unplanned` lists the changed files that no task document names, and records nothing. It prints `{"files": [...]}`.

## Roles

| Role | Model | Job |
| --- | --- | --- |
| PO | Fable | Settles every decision before the build, writes the spec, answers the other roles, asks you only what changes the product and nothing settles |
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

When the gate fails, the code writer gets two attempts on Haiku, then two on Sonnet, then the debugger gets two on Opus. After that the task is marked stuck and you are told what was tried. Review findings get two fix rounds, CI failures two. CI counts only once the pull request's head is the pushed commit. When a CI fix commits nothing, the failed runs are rerun once instead, and a second failure ends the task stuck as external or flaky. After a rerun, a failed check that still shows the old attempt's job link counts as still running.

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

The build keeps the code step from editing a test. Right before the code step it fingerprints the worktree, and every test file in it is protected; after the code step a protected file that changed or was deleted is listed in a `test_edits_restored` event and restored by the fix ladder, and a second change stops the task stuck. A file is a test file when its path starts with an entry of `testPaths`, for example `"testPaths": ["spec/"]`. Without `testPaths`, a file is a test file when its name contains `.test.` or `.spec.`, or a directory in its path is named `test`, `tests` or `__tests__`. New test files are allowed.

A spec can name the test files the task is meant to change in a section headed exactly `## Test files this task changes`, with one repo-relative path per `- ` bullet, backticks optional. The guard leaves those files out: they are not restored, not listed, and a second change does not stop the build. Only `spec.md` grants this, and the same section in `plan.md`, `tests.md`, `repro.md` or `design.md` exempts nothing. The list is read each time the guard runs, so a spec changed during the build counts. The review, tester and CI fix ladders are guarded like the code step: each fingerprints the worktree before its first rung, and once it passes the gate a protected test file it changed is restored the same way.

The categories with a test writer (`bug`, `feature` and `big-feature`) need a gate check named exactly `tests`. The build runs it right after the test writer, and the task is stuck when no test fails. Before that check, the build runs the gate for the role `test-writer`; when it fails, the test writer runs again with the failed checks, at most 2 more times, and then the task is stuck. The unit tests typed from plan.md may add the code the plan defines as stubs that only fail when they run (`todo!()` in Rust), so that in a compiled language they compile and fail with a count. When they do not compile, the build sends the test writer back once with the first compile error; a second failure is stuck with `the tests do not compile: <first error>`. A stub left in place fails the gate, because the test that names it still runs it.

A gate entry may carry `"roles"`, a list of the roles it gates, for example `{ "name": "lint", "run": "bun run lint", "roles": ["test-writer", "code-writer", "debugger"] }`. An entry without `"roles"` gates the code writer and the debugger, as before; an entry with `"roles"` gates exactly the roles listed. The build gates the test writer and the code-writing rungs; `"roles"` may name other roles, but nothing gates them. A config without any `"roles"` gates exactly as it did.

## Notifications

Set `DARK_FACTORY_NOTIFY` to a shell command. It receives the message on stdin, with `DARK_FACTORY_TASK` and `DARK_FACTORY_KIND` (`ready`, `waiting` or `stuck`) in its environment.

## Measuring

The factory keeps its tasks, worktrees and event log in `$DARK_FACTORY_HOME`, which defaults to `~/.dark-factory` on every machine. A factory task cannot continue on another machine, so its history stays where it ran.

Every step appends one event to `$DARK_FACTORY_HOME/events.jsonl`, and the events of a task are also appended to `tasks/<task>/events.jsonl`, with its `run_finished` line. A role's `role_finished` event carries its `sessionId`, the name of its transcript. `node scripts/stats.mjs` counts, from those events alone: tasks by category, outcomes, gate failures by check and by role, the code writer's first-try pass rate, escalations, CI results, review rounds, questions to you, roles added by the diff check, and handovers by route and by reason. It adds `costByRole`: per role, its `runs`, distinct `tasks`, `costUsd` and `costEstimated`. `node scripts/stats.mjs <task-id>` prints one task's report as JSON: per run its `status`, `startedAt`, `finishedAt`, `wallMs`, `costUsd`, `costEstimated`, `tokens` by kind, its `estimate` and `byRole`, one row per role and model with runs, turns, tool calls, duration, the four token sums and cost. A `role_finished` without a `costUsd`, such as a subagent run logged before costs were, is priced there from its tokens, cache writes at the 5-minute rate unless the event has the split, without the long-prompt rule, and marked `costEstimated: true`; with a model not in the table its cost is `null` and left out of the sums. Such a cost-less event that has an `agentId` holds the agent's whole transcript so far, so when the task has an earlier event of the same `agentId`, the report counts its token sums and turns minus that earlier event's, floored at 0.

Every role start appends `handover` with `from`, `to` and the `reason`: `pipeline`, `gate-failed`, `review-findings`, `unmet-criteria`, `ci-failed`, `question` or `po-answer`. The instructions the role received are saved as `tasks/<task>/handovers/NNN-<from>-to-<to>.md`, and the event carries the file, its `sha256` and its `bytes`. A role's reply, its `result` and `structured` output, is saved as `tasks/<task>/replies/NNN-<role>.json`, and `role_finished` points to it in `reply`, so a review finding or an unmet criterion outlives the transcript.

Every role run appends `role_finished` with its cost and tokens, and the red-test proof appends `tests_red` with the exit code and the failing count. For both builds the estimate is recorded at the start and the actual at the final status: `markStarted` appends `estimate` right after `task_started`, with the medians of `wallMs`, `tokens` and `costUsd` over the last 10 `ready` runs of the same category and `basis`, the number of runs used, and the first `ready`, `stuck` or `waiting` status of a run appends `run_finished` with the outcome, the total `costUsd` (`null` when no role reported one), the total tokens, the number of role runs and `wallMs`. The worker appends `run_started` with its `pid` and `isolation` (`systemd-scope` or `detached`), and a build command that finds a live worker appends `build_joined` with its `workerPid` and waits for that worker instead of starting one; each finished code, review and tester step appends `step_done` with the step and the worktree's `head`, and a rerun appends `step_skipped` for each step it skips. `node scripts/task.mjs show <id>` prints the task with its latest step and its latest `estimate`, and `stats.mjs` reports in `estimates` the median of actual ÷ estimate for wall time, tokens and cost.

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

Your own hooks never run in a role, and neither do MCP servers. The repo's Claude Code hooks don't run either: roles and the PO session start with `--setting-sources local`, because other repos have different hooks or none, so the factory cannot rely on them. The factory's only gate is `.dark-factory.json`. The plugin's own hooks still run, and git hooks still run on every commit a role makes.

A role still loads `.claude/settings.local.json` from its worktree. The repo's `.claude/settings.json` is not loaded; its `permissions` (`allow`, `deny` and `ask`) are copied into the `--settings` file after your filtered settings, never its `hooks`. Your `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR`) goes into the same file without `hooks`, `permissions`, `enabledPlugins` and `extraKnownMarketplaces`, so commit attribution and your other preferences apply. Each role call records which of your keys it passed and dropped as a `role_settings` event, without their values.

## Permissions

- Roles run with `--setting-sources local`, the plugin from `--plugin-dir`, and their own tool policy from `roles.mjs`. Your user settings come only through the filtered `--settings` file, so your hooks don't reach them. The repo's `permissions` come through the same file: its `allow` can widen a role's tools, its `deny` still binds, and the role's own denies still win.
- The PO session only needs `"Bash(node *dark-factory*/scripts/*)"`, for example in `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(node *dark-factory*/scripts/*)"]
  }
}
```
