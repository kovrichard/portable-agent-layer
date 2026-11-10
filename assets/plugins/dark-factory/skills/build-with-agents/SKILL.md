---
name: build-with-agents
description: Run a written dark-factory task to a pull request with the factory's roles as subagents of this session, instead of build.mjs. Use when the user asks to build a factory task with agents or subagents, or to run the subagent side of the factory A/B.
---

# Build a factory task with subagents

You are the product owner, and this session is the build. You run the same pipeline as `scripts/build.mjs`, but each role is a `dark-factory:<role>` subagent of this session, and every subagent works in this session's folder: the task's worktree. Code decides every pass or fail: you run the step commands and act on their exit codes, you never judge a check yourself.

The scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts`; run them with `node`, without `head` or `tail`: a crash prints its message above the stack trace, and a cut output loses it. Below, `$S` stands for that folder and `<id>` for the task id.

## Before you start

1. The task needs a written spec: `node $S/task.mjs show <id>` prints it with its category. Without a spec, write one first with the `dark-factory:po` skill, but do not start `build.mjs`.
2. This session must run inside the task's worktree, because subagents work in the folder the session started in, and without the repo's Claude Code hooks, because the factory's only gate is `.dark-factory.json`. Run `node $S/task.mjs prepare <id>`, read `worktree` from its output, and compare it with `git rev-parse --show-toplevel`. When they differ, stop and tell the user to start the session with the `po` command from `prepare`'s output: it starts `claude` in the worktree with `--setting-sources local`, the role settings file when one is written, and `--plugin-dir` for this plugin. Unattended, the `poUnattended` command: the same session headless, with the task folder and the PO's tools allowed.
3. Read `spec.md` in the task folder (`$DARK_FACTORY_HOME/tasks/<id>/`, `~/.dark-factory` when it is unset).

## Running a role

- Start a role with the Agent tool: `subagent_type: "dark-factory:<role>"`, never `isolation`, and the `model` the step names.
- The prompt is fixed, as in `build.mjs`, so the A/B compares orchestration and not prompts. It holds exactly:
  - the task id, the task folder, the worktree and the base branch;
  - the step's instructions below, word for word;
  - for a fix-ladder rung, an answer or a continued subagent: the step command's output, the gate's failed checks, the reviewer's findings or the PO's answer, pasted verbatim.

  Nothing else. Never add what to focus on, what an earlier role reported, what to confirm, or that findings are optional: a reviewer told what to check checks only that.
- Before every Agent and `SendMessage` call, record the exact prompt: `node $S/task.mjs handover <id> <role> <reason> <model>` with the prompt on stdin, where model is the one the step names and reason is `pipeline`, `plan-gate`, `plan-findings`, `gate-failed`, `test-fix`, `review-findings`, `ci-failed`, `question` or `po-answer`, as `build.mjs` names them.
- When a role's reply asks a question, answer it yourself from the spec, the code and what you know about the user, add the answer to the spec under **Decisions**, and continue the same subagent with `SendMessage`. When you rule that a test is wrong, start `dark-factory:test-writer` to fix only that test. Then run `node $S/step.mjs test-edits <id>`: when it lists only the files the test writer just fixed, run `node $S/step.mjs snapshot <id>` so the guard accepts your ruling, as `build.mjs` does after a test fix; when it lists any other file, handle it as step 2.3 does. Then continue the role that asked. Ask the user only what nothing settles, once, with your recommended answer, and wait.
- Record every role run: `node $S/task.mjs status <id> running "<role>: <one line>"`.
- The estimate is recorded at the start, when `task.mjs prepare` marks the task started, and the actual (`run_finished`) at the final status, when `task.mjs status` or `task.mjs ask` sets `ready`, `stuck` or `waiting`; there is no extra step for it.

## The pipeline

The task's category decides the roles before and after the code (`roles.mjs` `CATEGORIES`):

| Category | Before the code | After the code |
|---|---|---|
| small | none | reviewer |
| bug | debugger, test-writer | reviewer |
| feature | test-writer, planner | reviewer, tester |
| big-feature | architect, test-writer, planner | reviewer, tester |
| refactor | planner | reviewer |

### 1. Before the code

- **debugger** (opus): "Reproduce the bug described in the spec and write repro.md with the root cause."
- **architect** (opus): "Write design.md for this change."
- **test-writer**, acceptance tests (sonnet): run `node $S/step.mjs baseline <id>` first. Instructions: "Write the failing acceptance tests from spec.md only; there is no plan yet, so do not read plan.md. Write tests.md in the task folder mapping each test to the acceptance criteria it covers. Leave the tests uncommitted; the code writer commits them with the code." Then gate it: `node $S/gate.mjs <worktree> <id> test-writer <attempt> sonnet`, attempt 1 to 3. A non-zero exit starts the test writer again with the gate's failed checks, at most 2 more times; a third failure stops the build `stuck` with the failed checks. When no gate entry in `.dark-factory.json` lists `test-writer`, the command runs nothing and passes. Then `node $S/step.mjs prove-red <id>`; a non-zero exit stops the build `stuck` with its message.
- **planner** (opus): "Write plan.md for this change. Failing acceptance tests already exist in the worktree (see tests.md in the task folder); the plan must make them pass without changing them." Without a test writer: "Write plan.md for this change."
- **Plan gate**, up to 2 rounds: start **reviewer** (sonnet) with "This is the plan gate: there is no code and no diff yet. Review plan.md against spec.md only. Report one finding for each place where the plan narrows an acceptance criterion; adds behaviour, events, options, flags, files or dependencies that no criterion asks for; contradicts the spec, its Decisions or its Must not change; or leaves a decision to the code writer." Settle each finding in the spec's Decisions and have the planner apply them.
- **Unit tests**, when there is a test writer and a plan: `step.mjs baseline`, then **test-writer** (haiku): "Type one unit test per row of each example table in plan.md, in the test files the plan names. Test only what the tables state, change no other file, and leave the tests uncommitted. When plan.md has no example tables, change nothing." Gate it as the acceptance test writer is gated, with `node $S/gate.mjs <worktree> <id> test-writer <attempt> haiku`, also after a no-rise retry. When it changed files, `step.mjs prove-red`. On a no-rise, send it back once with the counts and the files it changed: a test file that fails to load counts as one failure, so it moves its tests into a new test file. A second no-rise stops `stuck`.

### 2. The code

1. `node $S/step.mjs snapshot <id>`.
2. Climb the code ladder until the gate passes: **code-writer** haiku, haiku, sonnet, sonnet, then **debugger** opus, opus. Instructions: "Implement the change described in <source>. Commit the uncommitted tests already in the worktree together with your code; every commit goes through the repo's hooks." `<source>` is `plan.md` when the category has a planner, `repro.md` when it has a debugger and no planner, and `the spec` otherwise, as `build.mjs` `codeSource` picks it. After each rung run `node $S/gate.mjs <worktree> <id> <role> <rung> <model>`. Exit 0 ends the ladder. Otherwise give the next rung the failed checks. After the last rung the build is `stuck`.
3. `node $S/step.mjs test-edits <id>`. When it lists files, the next rung of the fix ladder (sonnet, sonnet, opus, opus) restores each listed file to its snapshot content, commits, and makes the gate pass without editing a test. Run `test-edits` again; files listed a second time stop the build `stuck`.
4. `node $S/step.mjs unplanned <id>`. For each listed file decide keep or revert, record the decision in the spec, and revert with `git checkout origin/<base> -- <file>` and a commit.

### 3. After the code

Every fix ladder from here on (the reviewer's findings, the tester's unmet criteria and the CI failures) is guarded like the code ladder: run `node $S/step.mjs snapshot <id>` once before the ladder's first rung, not before each rung, and `node $S/step.mjs test-edits <id>` after the ladder passes the gate. Handle a non-zero exit of `test-edits` as step 2.3 does.

- **reviewer** (sonnet), up to 2 rounds: "Review the branch diff against its base and the spec." Record the round: `node $S/task.mjs review <id> <round> <findings>`. Each finding goes to the fix ladder, then the gate.
- **tester** (sonnet): "Test every acceptance criterion in the running app." Record it: `node $S/task.mjs test <id> <unmet>`. Each unmet criterion goes to the fix ladder, then the gate.

### 4. Ship

1. `node $S/ship.mjs sync <id>`, then `ship.mjs push <id>`, then `ship.mjs pr <id>`.
2. `node $S/ci-wait.mjs <id>`: exit 0 is green. Exit 1 sends the failed checks to the CI fix ladder (opus, opus), guarded as step 3 says, then push and wait again, at most 2 rounds.
3. `node $S/ship.mjs ready <id>`, then `node $S/task.mjs status <id> ready "<pr url>"`.

## Stopping

- `stuck`: `node $S/task.mjs status <id> stuck "<message>"`, then report the message and what was tried.
- `waiting`: the user's answer is needed; `task.mjs ask <id> "<question>"`, then stop.
- Never merge a pull request, and never skip a step command or overrule its exit code.

## Report

The PR link; each acceptance criterion and how it was checked; the decisions you made; the number of role runs, ladder rungs and review rounds, and the session's total cost when it is known.
