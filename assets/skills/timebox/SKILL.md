---
name: timebox
license: MIT
description: "Works on a task under a user-given time limit and stops at the deadline with a report of what was found or done so far. Use when the request names a duration or a clock time for the work (\"stop in 15 minutes\", \"spend at most an hour\", \"stop at 6 PM\", \"timebox this\")."
argument-hint: <duration or HH:MM> <task>
metadata:
  source: portable-agent-layer
  triggers:
    - "timebox"
    - "time box"
    - "stop in"
    - "spend at most"
    - "stop at"
    - "time limit"
---

# Timebox

Work on $ARGUMENTS until the deadline the user set, then stop and report, wherever the work stands. PAL enforces the deadline for the current project or folder through its hooks; this skill is how to work inside it.

## Workflow

1. **Parse the limit** from the request. A duration ("15 minutes", "an hour and a half") becomes `--for 15m` or `--for 1h30m`; a clock time ("by 6 PM", "at 18:00") becomes `--until 18:00`, the next such local time. If no limit is clear, this is not the skill — do the task normally.
2. **Start the box** before any other work:
   ```bash
   pal cli timebox start --for <15m|2h|1h30m> --task "<short task name>"
   pal cli timebox start --until <HH:MM> --task "<short task name>"
   ```
   Add `--report <path>` only when the user asked for the result in a file. The command fails if a box is already running for this folder; then ask whether to replace it (`pal cli timebox end`, then start) or work inside the one that exists.
3. **Work in small steps.** Run `pal cli timebox status` between steps; it prints the end time and the minutes left. Each user prompt during the box also carries "Time box until HH:MM, N min left". Plan the last step so it finishes before the deadline. Start nothing that cannot finish in the time left — a long build, a large download, a deep research pass — because a hook cannot interrupt a running command.
4. **Stop at the deadline.** After it, PAL's PreToolUse hook refuses shell, edit and write, web search and fetch, subagent and question calls with a message starting "Time box ended at HH:MM … Stop working now". Only `pal cli …` commands (optionally piped into `head` or `tail`) and writes to the `--report` path still run. Read-only tools may still answer, but do not keep working with them. Do not work around a refusal; move straight to the report.
5. **Report** in the final message, or in the report file when `--report` was given. Keep it short.
6. **End the box**: `pal cli timebox end`. A user prompt sent after the deadline clears it automatically; run `end` anyway so the state is explicit.

If the task finishes before the deadline, report then and run `pal cli timebox end` right away.

## Output format

The final message (or report file) has five parts, each one line or a short list:

- **Done / found** — the concrete results so far.
- **Not covered** — what the box cut off, or what was never reached.
- **Next** — the first steps to take if the work resumes, with the box ended.
- **Confidence** — a one-line judgment and its weakest point.
- **Box** — `started HH:MM, ended HH:MM` and whether the task finished early or was cut at the deadline.

## When to use

- The user gives a duration or clock time for the work: "research this but stop in 15 minutes", "spend at most an hour on the refactor", "stop at 6 PM", "timebox this to 30 minutes".
- The user says "timebox" or "time box" for any task.

## Do NOT use

- No time limit was given. Do the task normally; a time box without a user-stated limit is an invention.
- The user is leaving and nobody will answer questions — that is the `unattended` skill, which sets its own deadline and handles the absence.
- The user wants a reminder or an alarm with no work attached to it.
