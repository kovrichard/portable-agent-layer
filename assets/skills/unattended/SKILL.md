---
name: unattended
license: MIT
description: "Runs an approved list of tasks while the user is away — asleep, in a meeting, out for the afternoon — with nobody there to answer, then leaves a report for their return. Proposes finishable tasks and fallbacks, gets approval and a return time, starts the run with pal cli unattended, logs every decision, and finalises the report at the deadline. Use when the user says they are leaving and wants work to continue unattended, overnight, while they sleep, or until they are back."
argument-hint: "[return time] [tasks or goal]"
metadata:
  source: portable-agent-layer
  triggers:
    - "unattended"
    - "while I'm away"
    - "work on this while I sleep"
    - "overnight tasks"
    - "night task"
    - "until I'm back"
    - "I'm going to bed"
---

# Unattended run

Work through approved tasks with nobody present to answer, then hand back a report. Three phases: propose, run, report. Do not start the run until the user has approved the plan.

## Phase A — Propose (before the user leaves)

1. Resolve the current project from the working folder (`pal cli project resume <slug>` when the user names one). Read its notes, open progress nodes and recent sessions: tasks come only from this project.
2. Draft candidate tasks. Keep a task only if it can be finished alone, with no decision that only the user can make. For each kept task write: what it produces, how it will be checked (tests or a build when the project has them, a visual comparison, sources cited, a reread against the brief), rough time, and resource cost (memory, network, paid APIs). Flag dropped tasks with the decision they need.
3. Propose 1-2 fallback tasks the run takes when the approved list is finished early: deterministic, low-risk work such as fixing lint warnings, adding missing tests, or updating documentation.
4. Ask, in one question with your agent's ask tool: the return time, where the report goes (a file path, a page the project serves, or an artifact), and extra rules. Suggest the rule categories: no paid or keyed APIs, no downloads, memory caps on heavy commands, files or services that are off-limits.
5. Repeat back in short form: tasks in order, fallbacks, return time, report location, extra rules on top of the defaults listed below. STOP and wait for explicit approval. Edits to the list return to step 5.

Default rules every run carries (`pal cli unattended start` stores them; `--rule` adds more):
- Never ask. Decide, log the decision and its reason, list the question in the report.
- Check notes and earlier sessions before listing a question.
- Approved tasks, then fallbacks, nothing else. Other ideas become suggestions in the report.
- Never delete, push, deploy or publish anything except the report.
- One heavy process at a time. No subagents, no workflows.
- Verify each step as if the user were present.
- Only in a git repository: work on a branch, one logical step per commit, stage only your own changes, never push.

## Phase B — Run (after approval)

1. Set the deadline about 30 minutes before the return time so the report is final when the user is back. Start the run:
   ```bash
   pal cli unattended start --until <HH:MM> --task "<task 1>" --task "<task 2>" --fallback "<fallback>" --rule "<extra rule>" --report <path|url>
   ```
   Then `pal cli progress open "<run title>"` for the run's progress node.
2. In a git repository, create the work branch. Take tasks in the approved order, one at a time.
3. For each task: do it; verify it the way Phase A agreed (when the project has tests, run them twice and break-check every new test; when it has a build, run it); in a git repository, commit. Then `pal cli unattended log "<result> and how it was verified"` and `pal cli progress stopped "<next step>"`. Commits attach to the progress node on their own; do not attach them by hand.
4. Log every non-obvious decision with its reason at the moment of deciding: `pal cli unattended log "<decision>: <reason>"`.
5. Run `pal cli unattended status` between steps. Compare the minutes left with the estimated length of the next step; never start a step that cannot finish before the deadline, because a hook cannot interrupt a running command. Pick a shorter step or move to the report instead.
6. Write the report to the agreed location as soon as the first task lands, with "(draft)" in its title. Update it after every task so a crash leaves a usable report behind.
7. When the approved tasks are finished, take the fallbacks in order. The Stop hook refuses to end the turn before `pal cli unattended done`, so finishing early means moving on, not idling.
8. Treat every refused tool call as a rule: questions to the user and subagent or workflow calls are refused during the run, and after the deadline every working tool is refused except `pal cli` and writes to the report path. The refusal depends on the agent's tool names being known to PAL, so never ask or delegate even when no hook stops you. Never work around a refusal; log it and continue with the next permitted step.
9. After a context compaction, run `pal cli unattended status` and resume from the last logged step. Agents with a compaction hook also get the run's rules, tasks and log re-injected; re-read them first.

## Phase C — Report (at the deadline)

1. Finalise the report, removing "(draft)". Sections, in order:
   - **Done** — each task, how it was verified, and its commits, test counts and build result where the project has them.
   - **Comparisons** — for visual work, reference next to result, with an honest "falls short" note where it does.
   - **Failed, skipped, reverted** — what, why, and what was reverted.
   - **Questions for the user** — each answerable in one line; only questions the notes could not answer.
   - **Unfinished work** — files left mid-change and what state they are in; in a git repository, the branch and its uncommitted files.
   Label every inference of your own as such ("my reading:", "unverified:").
2. If the report is served somewhere, open the served copy (the `playwright` skill, or fetch the URL) and confirm it matches the local file.
3. `pal cli progress done`, then `pal cli unattended done`.
4. When the user returns, reply first with a summary under 100 words: what landed, the report location, and the open questions. Then run `pal cli unattended end`.

## Output format

- Phase A ends with the short-form plan (tasks, fallbacks, return time, report location, extra rules) followed by one approval question. Nothing runs before the answer.
- Phase B produces the task results (commits on the branch in a git repository), `pal cli unattended log` entries, progress-tree updates, and the draft report at the agreed location.
- Phase C produces the final report with the five sections above and, on the user's return, a summary under 100 words naming the report location and the open questions.

## When to use

- The user is leaving (sleep, meeting, travel, the rest of the day) and wants work to continue with nobody there to answer.
- The user asks for an overnight or night task, or wants the work to keep going while they are away or until they are back.
- A list of self-contained tasks exists, or can be drawn from the current project, that needs no user decision mid-way.

## Do NOT use

- The user stays at the keyboard and only wants a time limit on the work: that is the `timebox` skill.
- A single long-running command that should run in the background and be checked later.
- Tasks that hinge on a decision only the user can make: propose them, flag the decision, and leave them out of the run.
