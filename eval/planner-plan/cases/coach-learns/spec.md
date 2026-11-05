# A coach learns from every run and proposes role prompt changes

## Goal

The roles work, but they repeat the same kinds of mistakes, and the only thing that fixes them is the user noticing and asking for a prompt change. Examples:

- a repro that leaves the fix open;
- a spec that says where to report instead of what;
- a code-writer that deletes a line a grep criterion only seemed to forbid;
- a tester that judges criteria it can't see yet.

After this change a new role, the **coach**, studies every run that ends `ready` or `stuck`, on opus with the largest budget of any role. It finds what went wrong or cost more than it should, and turns that into **generalized** rules for the role prompts: rules about a class of mistake, never about this task's files or helpers. Its findings collect in the factory home. The user approves or rejects each one. An approved finding becomes an ordinary factory task that changes the plugin's role prompts through a pull request. That way the factory improves through its own pipeline, the same way LEARN feeds the Algorithm.

## Acceptance criteria

### The coach runs at the end of every run

1. `build.mjs` runs the `coach` role after a run ends `ready` or `stuck`. It runs after the status is saved and the user is notified, so the user never waits on it. It doesn't run for `waiting`. Afterwards it appends a `coach_finished` event with the number of new and updated findings. A test with a fake `claude` covers `ready`, `stuck` and `waiting`.
2. A coach that fails (non-zero exit, no structured result, over budget) appends a `coach_failed` event. The run's outcome, exit code and printed JSON stay unchanged. A test covers it.
3. The coach is a role like the others: `agents/coach.md` (model `claude-opus-5-5`), a policy in `ROLE_POLICIES`, and a result schema in `RESULT_SCHEMAS`:
   - it is read-only: reads plus read-only shell, with no Edit or Write;
   - its budget is the highest of all roles;
   - it gets `--add-dir` for the factory home, so it can read every task folder and the findings store.

### The coach reads the whole run

4. The coach's instructions name everything the run produced:
   - the spec with its Decisions;
   - `plan.md`, `design.md`, `repro.md` and `tests.md` when they exist;
   - the task's `events.jsonl`;
   - the diff against the base;
   - every role transcript of the run, by path.

   `role.mjs` records each transcript's path on `role_finished` as `transcriptPath`, so the coach never guesses Claude Code's folder layout. **Assumption to check first:** that `claude -p --output-format json`, or the session id together with the worktree, gives that path reliably. If it doesn't, ask the PO before choosing another way.
5. The coach also judges the PO: whether the spec caused a mistake. Examples: it routed a report to the PR body, or one of its criteria was read as forbidding something it didn't. A test pins this instruction in `agents/coach.md`.
6. **What the user changed after the factory.** `ship.mjs` records the pushed head commit on the `pushed` event (`head`). At the start of each coach run, `build.mjs` lists the tasks whose PR has merged since their last `pushed` event and whose branch has commits after that `head`. It gives the coach those commits' messages and diffs as "corrections the user made after the factory". This is the coach's strongest signal. A test with a temporary repo covers a branch with and without a later commit.

### Findings are generalized, collected and approved by the user

7. The coach returns findings, each with these fields:
   - `class`: a short name for the kind of mistake;
   - `role`: the role whose prompt should change, including `po`;
   - `rule`: the prompt text to add or change;
   - `evidence`: task id plus event, transcript line or commit;
   - `severity`: `high`, `medium` or `low`;
   - `metric`: what in `stats.mjs` or the events the rule should move, such as first-try gate pass, review findings, fix rounds or tester rounds.

   It may also return `updates` that add evidence to an existing pending finding of the same class instead of creating a new one.
8. Findings live in `$DARK_FACTORY_HOME/coach/findings.jsonl`, one JSON object per finding, with `id`, `status` (`pending`, `approved`, `rejected`), `createdAt`, the fields above and the list of evidence. The coach is given the pending and rejected findings with each run, so it updates instead of duplicating and doesn't propose again what the user rejected. Tests cover a new finding, an update and a rejected class.
9. **The generality check is deterministic, and it runs before a finding is stored.** A `rule` that contains any changed file path, file basename, or function or variable name added in the run's diff is rejected, and recorded as a `coach_rule_rejected` event with the matched name. A test covers a rule naming a helper from the diff, and one that doesn't.
10. `scripts/coach.mjs`:
    - `list` prints pending findings with their evidence count, grouped by role, high severity first;
    - `show <id>` prints one finding;
    - `reject <id> "<reason>"` stores the reason;
    - `approve <id>` creates a factory task (`task.mjs new`, category `small`, repo = the plugin's source repo given by `--repo` or `coach.repo` in `$DARK_FACTORY_HOME/config.json`) whose spec holds the goal, the rule, the role file, the evidence and the metric. It prints the task id. It does **not** start a build.

    Tests cover each command.
11. The PO skill gets a "Coach findings" section: when the user asks what the coach found, the PO runs `coach.mjs list`. On the user's approval the PO runs `coach.mjs approve`, shows the generated spec, and waits for go as for any task. Nothing is approved or built without the user.
12. Each merged rule's metric is reported. `coach.mjs list --applied` shows, for every approved finding whose task merged, the metric over the runs before and after the merge. When there are fewer than 3 runs after the merge it says "not enough runs" instead of a number.

### The coach's own rules

13. `agents/coach.md` tells the coach to:
    - look for the cost and the mistakes, not only for failures: retries, escalations, denied tools, wasted turns, review and tester rounds, questions, and the user's corrections;
    - propose only rules that would have prevented the mistake in a different task too, and state that other task in the finding;
    - prefer changing or removing an existing line of a role prompt over adding one, and propose consolidating a role prompt that has grown past 40 lines;
    - report nothing when the run was clean. An empty list is a valid result.

    A test pins these instructions.
14. The plugin README describes the coach, the findings store, `coach.mjs` and the approval flow.

### Proof

15. One real coach run on this machine, recorded by the PO after the PR exists. It runs on the finished `2026-10-20-roles-follow-the-repo-s-and-the-user-s-i` task (#138), whose known issues are the README line the code-writer deleted (restored by the user in aaaa93c) and the tester's extra round on criterion 10. Both runs ended `ready` before the coach existed, so this run is started by hand with a `coach.mjs run <task-id>` command that this task adds for that purpose. The PR shows the findings it produced and whether each one passed the generality check.
16. All gates in `.dark-factory.json` pass. Commits are conventional: `test(dark-factory): …` for the tests and `feat(dark-factory): …` for the code. One pull request into `canary`.

## Out of scope

- A per-user overlay of rules in the factory home. Rules land only through PRs to the plugin.
- Applying any rule without the user's approval, and building an approved task without the user's go.
- Changing the existing role prompts. That is the coach's output, through later tasks.
- Coaching `waiting` runs, and coaching runs from before this change, except the one by-hand run in criterion 15.

## Decisions

- The spec is approved: build it. The user typed "go" (2026-10-20, 12:33).

- Specced on the user's "coach is fine. the pr opener is good, plan it" (2026-10-20, 12:27).
- The user's calls (12:26): the coach runs on `stuck` runs too; it collects findings into the factory home for later approval; the user approves every rule.
- Approved rules land through a factory PR to the plugin's prompts, not a local overlay (the user, 12:27). Every user gets them, they're reviewed, and a rule is removed by a revert.
- The name is `coach`.
- Category `big-feature`: a new role, a new module (`coach.mjs`), a new store and new events. This run exercises the architect for the first time.
- The generality check is code, not a model, because a model judging its own rule is exactly where overfitting slips through.
- 2026-10-20: the code-writer asked "Which fix for the role test conflict (step 5 transcriptPath), and should the build test edits from the plan be applied or handed to the test-writer?"; the PO answered: 1) Role test conflict. Keep `transcriptPath` on the outcome, as design.md and plan step 5 say. Then add `transcriptPath: null` to the two existing `toEqual` outcome expectations in test/dark-factory-role.test.ts, at about lines 288 and 309 (the "reply" describe). The fake claude writes no session file, so `null` is the correct value. Do not drop the field from the outcome, and do not move it onto the event only: criterion 4 and coach.mjs's `taskTranscripts` depend on it travelling through `withoutReplyBody` to `role_finished`. This is an existing assertion that has to grow by one field because the design changed. It does not change any test's intent, so you make the edit yourself. Commit it with the code, or as a separate `test(dark-factory): …` commit. 2) Build test edits. The test-writer has already made them. test/dark-factory-build.test.ts has the fake claude's coach default, waits for the detached coach, and covers the ready, stuck, waiting and failing-coach cases. The first-run, six-attempt and CI-round expectations already end with coach (see tests.md). Do not apply the plan's build-test edits again. Write the code until those tests pass. If a build expectation is wrong only mechanically, the same rule as point 1 applies: you can fix it as long as what it asserts stays the same. If a test looks wrong in substance, send it back to the user rather than weakening it.
