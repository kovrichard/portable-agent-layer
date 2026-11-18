---
name: minimum
license: MIT
description: "Keeps working on one task for at least a user-given time, pass after pass, scoring the work against a written bar and fixing its weakest part each round, then summarises once the floor is reached. Works for code, writing, research, design, planning and personal decisions. Use when the user asks for a minimum amount of effort or for iteration until the result is good (\"work on this for at least 30 minutes\", \"keep improving this for an hour\", \"iterate until it's good\", \"cook it\")."
argument-hint: "[duration or HH:MM] <task>"
metadata:
  source: portable-agent-layer
  triggers:
    - "minimum"
    - "at least 30 minutes"
    - "work on this for at least"
    - "iterate until it's good"
    - "keep improving"
    - "cook it"
    - "minimum run"
---

# Minimum run

Work on $ARGUMENTS until at least the floor the user set, improving the weakest part on every pass. A floor is the opposite of a deadline: before it, PAL's Stop hook refuses to end your turn and sends you back with the goal, the bar, your last round and a lens for the next pass. The hook runs no model; it only replays what you wrote, so the goal, the bar and every round must be specific.

## Workflow

### 1. Intake: every question once, before the start

1. Parse the floor from the request. A duration ("at least 30 minutes", "an hour and a half") becomes `--for 30m` or `--for 1h30m`; a clock time ("until 18:00") becomes `--until 18:00`.
2. Ask everything in one call to your agent's ask tool, each question with a default the user can accept. Skip a question the request already answers:
   - the floor, when none was given;
   - what the work is for and who it is for;
   - "What does good look like to you?";
   - a reference or brief to check the work against;
   - constraints: what must not change, and what is out of scope.
3. Write the goal: one sentence saying what good looks like, for whom.
4. Write the bar: 2-5 dimensions, each as `<dimension>: <target>, <how it is checked>`. A check is something you can carry out (run, reread, compare, count), never "looks good". One line per kind of task shows the level:
   - **Code**: tests pass and every new test is break-checked; one review pass; edge cases listed and covered.
   - **Writing**: reread against the brief; the reader's top questions answered; a length target.
   - **Research**: N primary sources read; counter-evidence searched for; every claim cited.
   - **Design**: side by side with the reference, at mobile and desktop width.
   - **Planning**: failure modes per step; cost; at least one alternative compared.
   - **Personal decisions**: options listed; reversibility of each; what would change the answer.
5. Show the user the goal and the bar in a few lines, then start without waiting. After the start there are no questions.

### 2. Start the run

```bash
pal cli minimum start --for <30m|2h|1h30m> --goal "<what good looks like>" --bar "<dimension: target, how checked>" --bar "<dimension: target, how checked>"
pal cli minimum start --until <HH:MM> --goal "<what good looks like>" --bar "<dimension: target, how checked>"
```

Repeat `--bar` once per dimension. The command fails when a run (a time box, an unattended run or another minimum run) is already on in this folder; tell the user which one and let them end it.

### 3. Loop until the floor

1. Do a pass on the work.
2. Check the result against every bar dimension with the check the bar names. When the check is a tool (tests, a build, a source), run it.
3. Fix the weakest part.
4. Log the round:
   ```bash
   pal cli minimum round --scores "<dimension: n/10, ...>" --weakest "<the weakest part now>" --did "<what this pass changed>"
   ```
5. Start the next pass. `pal cli minimum status` prints the goal, the bar, the rounds and the minutes left.

Score honestly, because the next push-back is built from your scores and your weakest point:
- Score from the work as it stands, not from your memory of it.
- A score that only rises is not a check. Lower a score when a pass finds a new flaw.
- Name the weakest part precisely enough to act on ("the error path has no test"), not as a category ("quality").

What the hooks do before the floor:
- **A stop is sent back** with the minutes left, the goal, the bar, your last round and a lens. Do the next pass through that lens.
- **A stop with no round logged since the previous push-back** is sent back with "You stopped without logging a round". Do one pass on the weakest part and log it.
- **Questions are refused.** A call to an ask tool is refused, and a reply that ends in a question is sent back. Pick the sensible default, name it in the next round's `--did`, and continue.
- **Subagents are allowed.** The critic lens needs one.
- **After 20 push-backs the safety cap releases you.** The 20th says it is the last. Your next stop ends the turn; say in the summary that the floor was not reached.

The lenses rotate, one per push-back:

| Lens | What the pass does |
| --- | --- |
| recheck | Recheck against the brief or reference, one dimension at a time, scoring from the work itself. |
| critic | Hand the work to a subagent with no context, give it only the goal and the bar, fix what it finds. |
| skeptic | Read as a hostile reviewer, reader or user; fix what they would attack first. |
| alternative | Sketch a different approach, compare both against the bar, keep the better parts of each. |
| simplify | Cut what does not serve the goal: sections, steps, options, code, words. |
| verify | Verify the claim or assumption the work leans on most with a tool or a source; correct the work if it fails. |
| end-user | Use or read the work as the person it is for, start to finish; fix the first place they stumble. |

Never run `pal cli minimum end` before the floor unless the user asks: it is the user's way out, not yours. When the user writes during the run, answer, then continue the passes. After a context compaction, run `pal cli minimum status` and resume from the last round.

### 4. At the floor

The first stop after the floor is answered once with "the floor is reached". Then:

1. Do a final check against every bar dimension, running each tool check again.
2. Log the final round with `pal cli minimum round`.
3. Run `pal cli minimum end` so the state is explicit.
4. Write the summary below and stop.

## Output format

The final message, each part one line or a short list:

- **Goal** — the sentence the run started with.
- **Final scores** — one score per bar dimension, from the final round.
- **What changed** — the number of rounds and the main change of each, in order.
- **Still weakest** — the weakest part now, and what a further pass would do about it.
- **How it was checked** — the checks that were run and their results (test counts, sources read, the comparison made).
- **Floor** — reached at HH:MM, or not reached because the safety cap released the run.

## When to use

- The user sets a minimum time for the work: "work on this for at least 30 minutes", "keep improving this for an hour", "don't stop before 18:00".
- The user wants iteration until the result is good and gives, or accepts, a floor: "iterate until it's good", "cook it".
- One task of any kind whose result can be scored against a bar: code, writing, research, design, a plan, a personal decision.

## Do NOT use

- The user sets a ceiling ("stop in 15 minutes", "spend at most an hour"): that is the `timebox` skill, which stops at the deadline wherever the work stands.
- The user is leaving and wants a list of tasks worked through while nobody answers: that is the `unattended` skill.
- No floor was given and the user declines to set one in the intake: do the task normally.
- The task has one checkable answer that more passes cannot improve (a lookup, a rename, a version bump).
